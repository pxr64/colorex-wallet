# Threat model

What an attacker can and can't do against the Colorex Wallet, and which control
stops each path. Scoped to the **MV3 extension** in this repo (the taker wallet) —
not the broker/maker (separate private repo) or the Bitcoin/RGB networks.

Companion to [`architecture.md`](./architecture.md) (contexts, signing pipeline)
and [`sign-request.md`](./sign-request.md) (the decode-is-the-guarantee core).
Tracks the hardening in issue #1.

## Assets (what's worth stealing / corrupting)

| Asset | Where it lives | Worst case if lost |
|---|---|---|
| **Recovery mnemonic** | Encrypted vault in IndexedDB (`vault.ts`); transiently in memory during unlock/create | Total, portable, cross-wallet loss — reusable anywhere forever |
| **Account signing key** (BIP-86 `m/86'/1'/0'` xprv) | `chrome.storage.session` (memory-only) while unlocked; derived in the worker for signing | Drain *this* wallet (but not the portable phrase) |
| **Descriptor (account xpub)** | Encrypted at rest in IndexedDB | Privacy: derive every address → linkable full history |
| **RGB stock** (stash/state/index) | Encrypted at rest in IndexedDB | Privacy: holdings, contracts, amounts, history |
| **Signing intent integrity** | Computed in the worker per request | Tricked into signing a PSBT that moves more/other funds than shown |
| **Connected-origin allow-list** | `chrome.storage.local` | A phishing origin gains the access of a trusted dApp |

## Trust boundaries

Per [`architecture.md`](./architecture.md): the **page/dApp** and **page provider
(MAIN world)** are untrusted; the **content script (isolated world)** is a dumb
relay; the **background worker** and **popup/approval window** are trusted
extension contexts. The seed/keys live only in the trusted contexts, and the
**signing key never enters the popup** — the worker signs (worker-confined
signing, `background.ts` `finalize`).

## Adversaries

1. **Malicious / compromised dApp** (the connected web page). Can call
   `window.colorex.*` and supply arbitrary PSBTs and display hints.
2. **Phishing origin** — an unconnected page trying to act like a trusted dApp.
3. **Local disk / IndexedDB reader** — malware, a stolen/seized device, a synced
   profile, a forensic image. Has the at-rest bytes but **not** a running unlocked
   session.
4. **Network attacker** — MITM between the wallet and the RGB transport / Esplora.
5. **Compromised trusted extension context** — XSS in an extension page, or a
   malicious/compromised dependency running inside the extension (supply chain).
6. **Shoulder-surfer / clipboard-history reader** — sees the screen, or reads
   clipboard-manager history.

---

## Threats → mitigations

### 1. Malicious dApp tricks the user into signing

**Path.** The dApp orchestrates the swap and hands the wallet a PSBT plus display
hints (asset, amount). A malicious dApp lies in the hints, or crafts a PSBT that
spends more/other UTXOs than claimed.

**Mitigation.** The sign screen renders **wallet-derived `deltas`**, decoded from
the maker's PSBT in the worker (`decode_psbt`, `store.ts` `decodePsbt`) — **never**
the dApp's numbers. Inputs are matched to wallet-owned outpoints/addresses; the BTC
delta and fee are computed locally; swap direction is **inferred** from the wallet's
own BTC delta, not trusted. Treat the decode as the security core
([`sign-request.md`](./sign-request.md)). The wallet signs **exactly** the inputs
the decode identified (`sign.ts` `signPsbt` takes explicit `signInputs`), never
auto-detecting.

**Residual.** The decode's correctness is load-bearing. It is verified against live
maker PSBTs, but a decode bug (e.g. mis-attributing an input's ownership) would
weaken the guarantee — covered by tests + the wasm-boundary audit (open).

### 2. Phishing origin acts like a trusted dApp

**Mitigation.** Per-origin **connect-approval** popup before any read or signature
(same model as MetaMask), and the allow-list is **enforced at the worker sign
entry** — `signAndSend` refuses an unconnected origin (`background.ts`), so the
`recognized` pill is not merely cosmetic. The origin shown is the real sender
origin, not a dApp-supplied string.

### 3. Stolen device / disk image (offline attack)

**Path.** Attacker has the IndexedDB contents but no live session.

**Mitigations.**
- **Vault KDF is memory-hard.** Password → key is **Argon2id** (m=19 MiB, t=2,
  p=1; RFC 9106), so guesses can't be parallelized cheaply on GPUs/ASICs the way
  PBKDF2 allows. Params are stored in the vault and **bound into AES-GCM AAD**, so
  a header/param downgrade fails authentication. (`vault.ts`)
- **At-rest encryption.** The descriptor and the RGB stock are sealed with AES-GCM
  under keys **HKDF'd from the account xprv** (domain-separated), which exists only
  in the live session. Disk access alone yields opaque blobs — no addresses, no
  holdings, no history. (`store.ts` `sealBytes`/`openBytes`)
- **The mnemonic is never in session storage** — only the derived account xprv. A
  cold-storage leak of the session (it's memory-only, but defense in depth) costs
  this account's key, not the portable recovery phrase. (#2)

**Residual.** A *weak password* still caps everything: Argon2id raises the cost per
guess, but a guessable password is guessable. The strength meter (`password.ts`)
discourages this; it can't prevent it.

### 4. Online brute force against the unlock screen

**Mitigation.** Escalating, **persistent** lockouts (`store.ts` unlock guard):
5 free tries, then 30s → 1m → 5m → 15m → 30m → 60m, stored in
`chrome.storage.local` so they survive popup closes and worker restarts. Combined
with Argon2id (each attempt already costs ~19 MiB + real time), sustained guessing
is impractical. Optional wipe-after-N exists but is **disabled by default** (it's a
griefing/fund-loss footgun; the KDF + lockouts already deter brute force).

### 5. Auto-lock / unattended device

**Mitigation.** `chrome.idle` auto-lock at 15 min and on OS screen-lock
(`background.ts`), plus a sliding session expiry (`store.ts`). `lock()` clears the
in-memory key **and** the decrypted stock and the session entry, so a locked wallet
holds no plaintext key material or RGB state in memory.

### 6. Network MITM

**Mitigation.** All transport is HTTPS to the RGB transport / Esplora; no key
material is ever sent (signing is local). A MITM can serve **wrong chain data**
(e.g. claim a witness is mined) — but the security guarantee for *signing* is the
local PSBT decode, not the indexer. Worst case from a lying indexer is a wrong
*balance/confirmation display*, not a wrong signature. (Indexer-trust hardening —
e.g. SPV/headers — is out of scope here.)

### 7. Compromised trusted context (XSS / malicious dependency)

**This is the inherent ceiling of a browser hot wallet.** While unlocked, code
running inside the extension can reach the session key and sign. Mitigations
**shrink blast radius**, they don't eliminate it:
- Strict CSP — `script-src 'self' 'wasm-unsafe-eval'` (no remote/`eval`'d JS; wasm
  only). The `wasm-unsafe-eval` widens surface and is audited (open item: verify no
  remote/eval'd code, keys not retained/logged across the wasm boundary).
- Signing is worker-confined; the popup never holds the key.
- The mnemonic is confined to the unlock/create moment and the vault, not the
  session — so even a compromised context leaks *this account's* key, not the
  portable phrase.
- Supply-chain hardening (pin/audit deps, reproducible wasm, anti-exfil lint) is an
  open item.

### 8. Screen / clipboard exposure of the recovery phrase

**Mitigations.** The phrase is **reveal-gated** (blurred behind a tap) on the setup
screen so it isn't exposed/screenshot-caught the instant the wallet is created, with
a "don't screenshot or paste online" warning (`Onboarding.tsx`). Copies of the
phrase/addresses **auto-clear** from the clipboard ~30s later (`clipboard.ts`,
`CopyChip sensitive`). **Best-effort:** the popup is ephemeral, so a forced close
before the timer leaves the value; and we can't read the clipboard (no
`clipboardRead` permission) so a clear overwrites unconditionally. We deliberately
don't clear on blur/unmount (it would break copy → paste-into-password-manager).

---

## Trade-off: at-rest encryption gates reads behind unlock

Encrypting the descriptor and stock under the session-only xprv key means anything
that reads them — **balances, address derivation, `createInvoice`, the dApp
inventory, and the consignment import-queue drain** — requires an **unlocked
session** (previously some worked while locked). The import-queue drain **defers**
while locked rather than erroring (`import-queue.ts`, `canAccessStock`): consignments
stay durably queued and import on the next unlock, so **incoming RGB is never
stranded** — it just lands when the wallet is next opened (which it must be to see
or use the RGB anyway). This is the accepted cost of privacy-at-rest.

## Out of scope / open

- **Hardware-signer path** — keep `signPsbt` swappable so power users can keep the
  seed off-device entirely (removes threat #7's ceiling for them).
- **wasm-boundary audit** — verify keys passed into wasm aren't retained/logged and
  no remote/eval'd code runs under `wasm-unsafe-eval`.
- **Supply chain** — dep pinning/audit, reproducible wasm build, verify the shipped
  `.wasm` matches source, anti-exfil lint/test.
- **Indexer trust** — the wallet trusts the RGB transport / Esplora for chain state.
- The **broker/maker** (separate private repo) and the **Bitcoin/RGB networks**.

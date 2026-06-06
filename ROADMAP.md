# Roadmap

Milestones follow the build order in `design_handoff_sign_tx/INTEGRATION.md` §5,
adapted for the Colorex RFQ swap model. Each builds on the last; the hard
unknowns are front-loaded.

## M0 — Scaffold ✅ (this commit)
MV3 + Vite/React shell; background worker, content-script + page provider stubs;
the two-client split (`src/sdk` + `src/colorex`); design-system port (`ui/theme`,
`ui/atoms` from the handoff tokens); the **signature screen fully ported** and
previewable on mock data (`index.html?id=mock`).

## M1 — Browser `rgb-lib` / `@utexo/rgb-sdk` (make-or-break) ⏳
The central task. Land a **WASM build of `rgb-lib`** + a **browser fork of
`@utexo/rgb-sdk`** that runs in the service worker:
- swap filesystem `dataDir` → IndexedDB/OPFS,
- swap the Electrum-socket indexer → the Esplora HTTP indexer,
- enumerate touched Node built-ins (`fs`, `net`, `crypto`).
**Exit:** `generateKeys` / `initialize` / `getBtcBalance` run inside the worker;
replace `StubWalletSdk` with the real adapter. Also confirm the **consignment
delivery model** (raw blob vs RGB-transport pull) — see docs/swap-flow.md risk 1.
*Fallback if WASM stalls: a local native-host or server transport behind the same
`WalletSdk` interface.*

## M2 — Keys + lock + onboarding
Encrypted seed vault on device; in-memory unlock; create/restore flows
(`generateKeys` / `deriveKeysFromMnemonic` / backup restore).

## M3 — Read path
Home balances + activity + receive: `getBtcBalance`, `listAssets`,
`getAssetBalance`, `blindReceive`/`witnessReceive`, `getAddress`. Per-network
config (signet first).

## M4 — Provider pipeline live
`window.colorex` + content script + worker end-to-end with a **throwaway test
dApp page**. Open the approval window from a real worker-supplied request (start
with a hard-coded `SignRequest`) — exercises the hardest plumbing before any
decode/crypto.

## M5 — Decode → `SignRequest` + broker client (security core)
Drive the broker (`requestQuotes → acceptQuote`), take the maker's partial PSBT,
and **decode it** (+ RGB metadata) into real `deltas`. Do **rgb-rfq OpenAPI
(#6)** here and codegen `src/colorex` to replace the hand-written client. Test
hard: fee-only, multi-asset, unrecognized origin, malformed PSBT.

## M6 — Real signing + settle
On approve: `signPsbt` → `broker.submitSignedPsbt` (maker broadcasts) → accept
the consignment into the on-device stash → resolve the dApp promise. Wire the
signing stepper to real milestones, not timers.

## M7 — Internal Send, then on-chain & Lightning
Internal RGB/BTC send reuses M5–M6. Then `onchainReceive`/`onchainSend*` and
`*LightningInvoice*` as the product needs.

---

### Cross-cutting / open questions
- **Consignment delivery** (M1/M5): does the maker return a blob the wallet
  accepts directly, or POST to the taker's RGB transport for `refreshWallet` to
  pull? Confirm against `rgb-lib`.
- **Invoice/schema compat** (M5): the maker (rgb-ops) and wallet (rgb-lib) are
  both RGB-Tools; verify NIA consignments + `witnessReceive` invoices interop.
- **Pricing** (M3+): the SDK returns amounts, not USD — wire a price source for
  the `usd` display fields.
- **Hardware signing** (later): keep `signPsbt` swappable so an HSM/hardware
  signer can drop in.
- **Retire** `rfq-wallet` / `wallet-wasm` in the exchange repo — superseded by
  `@utexo/rgb-sdk`.

# M1 — rgb-lib in the browser: feasibility findings

> Status: **investigated 2026-06-06.** Conclusion: there is **no off-the-shelf
> browser/WASM build of rgb-lib.** Target C requires either UTEXO publishing a
> wasm build, or us porting the Rust rgb-lib to wasm32 — a substantial effort.
> A Hybrid interim ship is available and keeps keys on-device.

## ✅ Spike result (2026-06-06): the RGB core compiles to wasm32

A throwaway crate depending on **`rgb-api =0.11.1-rc.6` (`default-features=false`,
no electrum/fs)** built cleanly for **`wasm32-unknown-unknown`** — **110 rlibs, 0
errors**, including the whole RGB stack: `rgb`/`rgbcore`/`rgbstd`/`rgbinvoice`/
`psrgbt`, `aluvm`, `bp-core`, `strict_encoding`/`strict_types`, `commit_verify`,
`single_use_seals`, `amplify`. `getrandom` (0.2 + 0.3) is in the tree and compiled
(ensure its `js` feature for the real wasm-bindgen build — a one-liner).

**Conclusion:** the hard part — RGB consensus / validation / runtime logic — **is
wasm-able**. The wasm blockers are *only* the peripheral layers that `rgb-lib`
bundles (sea-orm/SQLite storage, blocking-reqwest/Electrum indexer, fs backup),
all of which have browser-native replacements. So we **don't** need to port all of
`rgb-lib`. The viable path is the lean **Option B2** below.

### And it *runs*, not just compiles (`rgb-wasm/`)

A `wasm-bindgen` crate over `rgb-api` (`rgb-wasm/`) builds via `wasm-pack`
(`--target web` → `pkg/rgb_wasm_bg.wasm`, ~1.2 MB) and **executes RGB logic** in
a JS runtime:

```
version       : rgb-wasm 0.0.0 (rgb-api 0.11.1-rc.6)
is_valid_contract_id('rgb:eejuoPHh…')  → true   (real engine, ran in wasm)
is_valid_contract_id('not-a-contract') → false
parse_invoice('totally-bogus')         → rejected
```

So M1's core question is answered end-to-end: **the RGB engine compiles AND runs
in wasm.** Decision confirmed: build on our own wasm core; **drop `@utexo/rgb-sdk`**
(native, can't run in-browser). Keep using UTEXO's *hosted* RGB proxy + Esplora
endpoints via `fetch` (runtime-agnostic services). A UTEXO partnership / their own
wasm build can be revisited later — not on the MVP path.

### Stateful `Stock` + persistence also proven (the last unknown)

`demo_stock_persistence()` (in `rgb-wasm/`): a fresh `Stock::in_memory()` imports
the NIA schema (`Kit::load` + `import_kit` — a real stateful mutation), then the
three in-memory providers are strict-serialized to bytes, a new `Stock` is rebuilt
from those bytes (`from_strict_serialized` + `Stock::with`), and re-queried:

```
schemata before=1, after_reload=1; serialized bytes stash=4432 state=10 index=22
```

The imported schema **survives the serialize → deserialize round trip in wasm.**
This is the IndexedDB persistence model: wasm holds the `Stock` on the in-memory
providers (`MemStash`/`MemState`/`MemIndex`), and JS persists/loads their
strict-serialized bytes to IndexedDB — exactly what `FsBinStore` does with files
natively. **No fundamental RGB unknowns remain; the rest is assembly.**

## What `@utexo/rgb-sdk` actually is

- `@utexo/rgb-sdk@1.0.0-beta.8` — wraps `@utexo/rgb-lib`, uses `axios` (HTTP
  transport ✓ browser-friendly), `@bitcoindevkit/bdk-wallet-node`, and
  `bare-node-runtime` (targets Node / Holepunch "bare" — **not** the browser).
  Keyword list includes `wasm` (aspirational — see below).
- **`@utexo/rgb-lib@0.3.0-beta.18`** is the blocker: it ships **native binaries
  only** (`@utexo/rgb-lib-linux-x64`, `-linux-arm64`, `-darwin-arm64` — no wasm,
  no Windows), built via **SWIG over C++** bindings of the Rust rgb-lib
  (RGB-Tools/rgb-lib-nodejs). A native Node addon **cannot run in a browser**, and
  there is no wasm roadmap in its docs.
- RGB-Tools publishes **Node (SWIG/C++), Python, Swift (uniffi)** bindings — **no
  wasm target** anywhere.

## The Bitcoin half is already solved

`@bitcoindevkit/bdk-wallet-node` comes from **`bitcoindevkit/bdk-wasm`**, which
also ships `@bitcoindevkit/bdk-wallet-web` — "a descriptor-based wallet library in
WebAssembly for browsers." So BDK (keys, descriptors, BTC UTXOs, PSBT signing) is
browser-ready. The gap is the **RGB-specific** stack.

## Why a wasm build of rgb-lib is non-trivial (rgb-lib Cargo.toml)

| Layer | Dependency | wasm32-unknown-unknown? |
|---|---|---|
| Storage | `sea-orm` + `sqlx-sqlite` | ✗ needs a filesystem SQLite; no first-class wasm path |
| Indexer | electrum **and** esplora via `reqwest` **blocking** | ✗ blocking I/O; wasm needs async `fetch` |
| FS utils | `tempfile`, `walkdir`, `zip` (backup/restore) | ✗ filesystem |
| WASM support | *(none)* — no `wasm32` features/targets defined | — |
| RGB core | `rgb-ops` / `rgb-invoicing` / `rgb-schemas` `=0.11.1-rc.10` | likely portable (mostly pure compute), but default features pull `*_blocking` |

A browser build means forking rgb-lib to: replace sea-orm/SQLite storage with an
IndexedDB/OPFS-backed store, replace the blocking-reqwest indexer with async
`fetch` (Esplora HTTP), strip/shim the fs-based backup utils, and add
`wasm-bindgen` glue. **sea-orm-on-wasm is the crux risk.** Estimate: weeks of
specialised Rust+wasm work, uncertain.

## The deeper finding: UTEXO targets Bare/WDK, not the browser

`@utexo/wdk-wallet-rgb` + `@utexo/rgb-lib-bare` ("Bare native addon wrapping
rgb-lib C FFI for use in **bare worklets**") reveal the real architecture:
UTEXO's RGB wallet is an RGB module for **Tether's Wallet Development Kit (WDK)**
running on **Holepunch's Bare** runtime (the JS runtime behind Pear).

- **Bare is not a browser.** It's an embeddable JS runtime that runs **native
  addons** on mobile / desktop / embedded — an alternative to Electron/React
  Native, *not* a browser/WASM environment.
- So the native rgb-lib addon "just works" — self-custodial, keys on device, no
  server — **but only inside a Bare-hosted app**, never a Chrome MV3 extension.
- This means UTEXO is **unlikely to ship a browser/WASM build** at all: their
  target runtime is Bare, where they don't need one. The browser is off their
  happy path by design.

### The actual decision: delivery target

This is bigger than "wasm port vs hybrid". It's **which runtime the Colorex
wallet ships on**:

1. **Browser extension (MV3)** — what the handoff assumes. UTEXO's stack can't run
   here; needs the WASM port (B) or the Hybrid server (C) below.
2. **Bare / Pear app (mobile + desktop)** — UTEXO + Tether WDK's intended path.
   The native `@utexo/rgb-lib-bare` runs as-is in a Bare worklet: self-custodial,
   no server, no WASM. Cost: it's a standalone app, not a browser extension, so
   the dApp integration changes (no injected `window.colorex`; the wallet is an
   app the dApp links to / deep-links, or hosts an in-app dApp browser).

If a browser extension is a hard product requirement → Options B/C. If "a
self-custodial RGB wallet" is the requirement and the form factor is flexible →
a Bare/Pear app is the path of least resistance and uses UTEXO's stack as designed.

## Options

**A — Ask UTEXO for a wasm build (recommended first).** Their SDK is tagged
`wasm`; a wasm `@utexo/rgb-lib` may be in progress. If they ship it, Target C
becomes nearly free. The handoff already flags "confirm with RGB-Tools/UTEXO" as
an open question. Fastest path; do this regardless.

**B1 — Fork all of rgb-lib to wasm.** Swap rgb-lib's sea-orm/SQLite storage,
blocking-reqwest indexer, and fs backup for wasm equivalents. Largest effort,
highest risk (sea-orm-on-wasm). Not recommended given B2.

**B2 — Lean: wasm RGB core + JS/TS shell (recommended for the extension).** The
spike proves the RGB core compiles to wasm32. So compile *just the RGB protocol
core* (`rgb-api` & friends) to wasm via `wasm-bindgen`, and build the peripheral
layers in JS/TS where the browser is strong:
- **storage** → IndexedDB/OPFS (our own persistence around the wasm core)
- **indexer** → Esplora **HTTP `fetch`** (UTEXO already hosts one)
- **bitcoin wallet / PSBT / keys** → **`@bitcoindevkit/bdk-wallet-web`** (already wasm)
- **RGB transport** → `fetch` to the hosted RGB proxy
This sidesteps sea-orm entirely (the worst blocker) and reuses the proven-wasm
RGB core. Real work, but each piece is browser-native and de-risked.

**C — Hybrid interim ship (the handoff's documented fallback).** Run the native
`@utexo/rgb-sdk` in a **server** (or a local native-messaging host); the extension
holds the seed and **signs PSBTs on-device** (bdk-wasm / `@scure/btc-signer`).
Keys never leave the device; only the RGB stash + PSBT *construction* run
server-side for v1. Ships now; migrate to Target C when a wasm rgb-lib exists.
Needs the state/seed-split + single-online-instance constraints confirmed
(INTEGRATION.md §6).

## Recommendation / next steps

**Decision (2026-06-06): browser extension is the target.** With the spike green,
pursue **Option B2** (lean: wasm RGB core + JS/TS shell). Concretely:

1. ✅ **De-risk spike — DONE:** `rgb-api` core compiles to `wasm32` (see top).
2. **Prototype the wasm boundary:** a small `wasm-bindgen` crate over the RGB core
   exposing the operations the wallet needs (validate consignment, build/inspect
   transfer, parse invoice, derive seals), with `getrandom`'s `js` feature on.
   Prove it loads + runs one real operation in the extension service worker.
3. **Wire the JS shell incrementally:** `bdk-wallet-web` for keys/PSBT/BTC UTXOs;
   IndexedDB for the RGB stash; Esplora `fetch` for the indexer; `fetch` to the
   RGB proxy for transport. Each lands behind the existing `WalletSdk` interface.
4. **(Optional) Ask UTEXO** whether a browser/wasm build is on their roadmap — if
   yes, it could replace our B2 core. Not blocking; nice-to-have.
5. **Stay unblocked:** M2 (keys/lock), M3 (read path), M4 (provider pipeline) are
   written against the `WalletSdk` interface and work regardless — build in parallel.

> Hybrid (Option C) is no longer the expected path — keep it only as a fallback if
> the wasm boundary in step 2 hits an unforeseen wall.

## Sources
- npm: `@utexo/rgb-sdk`, `@utexo/rgb-lib`, `@bitcoindevkit/bdk-wallet-node`
- github.com/UTEXO-Protocol/rgb-lib-nodejs · github.com/RGB-Tools/rgb-lib · github.com/bitcoindevkit/bdk-wasm

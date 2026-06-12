# Colorex Wallet

A self-custodial **RGB-on-Bitcoin wallet** delivered as an **MV3 browser
extension** — the taker wallet for the [Colorex](https://colorex.exchange) RFQ
exchange. Keys and RGB state live on the device; the wallet signs locally.

> Status: RGB runs **in-browser** via our own `rgb-wasm/` build (ROADMAP M1
> shipped), and the wallet has driven **live signet BTC↔RGB swaps** end-to-end.
> See [ROADMAP](./ROADMAP.md) for milestone status.

## Architecture (Target C — browser-native)

RGB is compiled to **WASM** (our own `rgb-wasm/` crate over `rgb-api`) and run
inside the MV3 **service worker** — the full RGB lifecycle (keys, balances,
invoices, transfers) happens on-device, against a hosted RGB transport + Bitcoin
indexer. No backend required for the wallet itself.

Two clients, by design (see [docs/architecture.md](./docs/architecture.md)):

1. **RGB WASM wallet** (`src/wallet/`, over `rgb-wasm`) — wallet lifecycle: keys,
   balances, receive-invoices, `signPsbt`, accept-consignment.
2. **Colorex broker client** (`src/colorex/`) — the swap path. Colorex swaps are
   **RFQ atomic BTC↔RGB swaps where the maker builds + broadcasts the PSBT**; the
   taker only creates an RGB invoice, signs the maker's PSBT, and accepts the
   consignment. This is **not** the SDK's generic `sendBegin/sendEnd` transfer —
   see [docs/swap-flow.md](./docs/swap-flow.md).

```
 dApp (app.colorex.exchange)
   └─ window.colorex.signAndSend(intent)        src/provider/inject.ts
        └─ content script                        src/provider/content-script.ts
             └─ background worker (WASM SDK)      src/worker/background.ts
                  ├─ broker quote → accept → maker PSBT     src/colorex/
                  ├─ DECODE PSBT → SignRequest  (security core; never trust dApp amounts)
                  └─ open approval window → SIGN screen      src/ui/screens/SignScreen.tsx
                       └─ Sign → signPsbt → broker /sign → accept consignment → resolve
```

## Layout

```
src/
├── wallet/     RGB WASM adapter (rgb-wasm) — keys, balances, invoices, transfers
├── sdk/        legacy WalletSdk interface + stub (scaffold-era)
├── colorex/    broker client + TS types (vendored contract, not a live dep)
├── provider/   window.colorex provider + content-script relay
├── worker/     MV3 background: SDK host, request registry, window opener
├── ui/         theme + atoms (ported tokens) + screens (Sign screen ported)
└── types/      SignRequest contract
docs/                       architecture · swap-flow · sign-request · broker API contract
```

## Develop

```bash
pnpm install
pnpm dev         # vite dev server (HMR); writes the unpacked extension to dist/
pnpm build       # build:wasm + tsc --noEmit + vite build → dist/
pnpm typecheck
```

Preview the signature screen without a backend: build, open the popup at
`index.html?id=mock` (renders the design on mock data).

## Install in Chrome (developer build)

The extension isn't on the Web Store — you load an **unpacked** build.

**Prerequisites**

- Node 18+ and [pnpm](https://pnpm.io).
- For the RGB WASM (`pnpm build` runs `build:wasm`): a Rust toolchain plus
  [`wasm-pack`](https://rustwasm.github.io/wasm-pack/) and the wasm target —
  `rustup target add wasm32-unknown-unknown`. (Only needed when the `rgb-wasm/`
  Rust changes; the built `rgb-wasm/pkg/` is gitignored.)

**Build, then load it**

```bash
pnpm install
pnpm build        # → dist/   (use `pnpm dev` instead for HMR while developing)
```

1. Open **`chrome://extensions`** (or Chromium/Brave/Edge equivalent).
2. Toggle **Developer mode** on (top-right).
3. Click **Load unpacked** and select this repo's **`dist/`** folder.
4. The Colorex Wallet appears in the list — pin it from the puzzle-piece menu for
   quick access.

**Iterating**

- `pnpm dev` rebuilds `dist/` on save with HMR; most UI changes hot-reload. After
  changes that touch the **manifest, service worker, or content script**, click
  the **↻ reload** icon on the extension card (or re-run Load unpacked).
- A fresh `pnpm build` is a full production bundle — reload the extension after it.

**Try it against a local dApp**

`window.colorex` is injected on `app.colorex.io` **and** on `localhost` /
`127.0.0.1` (any port), so you can build a dApp locally and connect to the wallet.
Injection ≠ access: every origin still goes through the per-origin connect-approval
popup before it can read balances or request a signature.

> RGB runs in-browser via our own **`rgb-wasm/`** build (a `wasm-bindgen` layer
> over `rgb-api`), not the Node-only `@utexo/rgb-sdk`. The live wallet drives it
> through the `src/wallet/` adapter. (A legacy `WalletSdk` stub lingers under
> `src/sdk/` from the scaffold era.)

## Relationship to the exchange backend

The Colorex exchange (broker + makers + RFQ protocol) is a **separate private
repo**. This repo is **self-contained**: it depends only on the *public broker
API contract*, vendored in [`docs/colorex-broker-api.md`](./docs/colorex-broker-api.md)
and `src/colorex/types.ts` — never a live code dependency. Keep exchange
internals out of this public repo.

See [`docs/sign-request.md`](./docs/sign-request.md) for the sign-screen contract
and [CLAUDE.md](./CLAUDE.md) for the working conventions.

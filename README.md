# Colorex Wallet

A self-custodial **RGB-on-Bitcoin wallet** delivered as an **MV3 browser
extension** — the taker wallet for the [Colorex](https://colorex.exchange) RFQ
exchange. Keys and RGB state live on the device; the wallet signs locally.

> Status: **scaffold** (M0). The wallet SDK runs against a stub until the browser
> build of `@utexo/rgb-sdk` lands (see [ROADMAP](./ROADMAP.md) M1). The signature
> screen is fully ported from the design handoff and previewable on mock data.

## Architecture (Target C — browser-native)

The wallet wraps **`@utexo/rgb-sdk`** (`UTEXOWallet`, over `rgb-lib`) compiled to
**WASM** and run inside the MV3 **service worker** — the full RGB lifecycle
(keys, balances, invoices, transfers) happens on-device, against the SDK's hosted
RGB transport + Bitcoin indexer. No backend required for the wallet itself.

Two clients, by design (see [docs/architecture.md](./docs/architecture.md)):

1. **`@utexo/rgb-sdk`** (`src/sdk/`) — wallet lifecycle: keys, balances,
   receive-invoices, `signPsbt`, accept-consignment.
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
├── sdk/        @utexo/rgb-sdk interface + stub (WASM adapter lands in M1)
├── colorex/    broker client + TS types (vendored contract, not a live dep)
├── provider/   window.colorex provider + content-script relay
├── worker/     MV3 background: SDK host, request registry, window opener
├── ui/         theme + atoms (ported tokens) + screens (Sign screen ported)
└── types/      SignRequest contract
docs/                       architecture · swap-flow · sign-request · broker API contract
```

## Develop

```bash
npm install
npm run dev        # vite dev server; load the unpacked extension from dist/
npm run build      # tsc --noEmit + vite build → dist/
npm run typecheck
```

Preview the signature screen without a backend: build, open the popup at
`index.html?id=mock` (renders the design on mock data).

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

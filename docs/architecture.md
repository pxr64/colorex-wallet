# Architecture

## Target C — browser-native, self-custodial

RGB is compiled to **WASM** and run inside the MV3 **background service worker**.
The full RGB lifecycle — keys, addresses, balances, invoices, transfers — happens
**on device**, against a hosted RGB transport + Bitcoin indexer. No custodial
backend; the trust note ("keys and RGB state never leave this device") is
literally true.

The published `@utexo/rgb-sdk` is Node-only, so rather than fork it we built our
own **`rgb-wasm/`** crate — a `wasm-bindgen` layer over `rgb-api` that swaps the
filesystem `dataDir` for IndexedDB/OPFS and the Electrum socket for HTTP indexing
(ROADMAP M1, **shipped**). The live wallet runs through the `src/wallet/` adapter
over that build; `create_transfer` drives the dapp sell leg. (A legacy
`WalletSdk` interface + stub lingers under `src/sdk/` from the scaffold era.)

Fallbacks that were kept behind the interface in case WASM stalled (a native-host
helper, or a server that builds PSBTs while the client keeps `signPsbt`
on-device) are no longer needed.

## Contexts (MV3)

| Context | File(s) | Role |
|---|---|---|
| **Page provider** | `src/provider/inject.ts` | injected into the dApp; exposes `window.colorex` (promise-based, id-correlated). Can't reach the worker directly. |
| **Content script** | `src/provider/content-script.ts` | isolated world; injects the provider, relays page ↔ worker. |
| **Background worker** | `src/worker/background.ts` | hosts the WASM SDK + Colorex client; holds the **pending-request registry** (must outlive the popup); builds the verified `SignRequest`; opens the approval window; signs + finalizes. |
| **Popup / approval window** | `src/ui/*` | the wallet UI and the signature approval screen (opened with `?id=<requestId>`). |

The worker is the brain: a request must survive the popup closing, so it lives in
the worker's `Map`, not in React state.

## The two clients

- **`src/sdk/`** — `@utexo/rgb-sdk`: wallet lifecycle (`initialize`,
  `getBtcBalance`, `listAssets`, `blind/witnessReceive`, `signPsbt`,
  `acceptConsignment`, `refreshWallet`).
- **`src/colorex/`** — broker client: `requestQuotes`, `acceptQuote`,
  `submitConsignment`, `submitSignedPsbt`. Talks to the Colorex broker; the maker
  builds + broadcasts the swap. See `swap-flow.md`.

Keeping these separate means the wallet works standalone (send/receive/balances)
and the exchange is just one more thing it can sign for.

## The signature pipeline

```
window.colorex.signAndSend(intent)         ── dApp intent (NOT trusted for display)
  → content script → worker
      → broker: requestQuotes → acceptQuote → maker's partial PSBT
      → DECODE the PSBT (+ RGB metadata) → SignRequest.deltas   ← security core (M5)
      → open approval window (?id=…)
          → user Signs
              → sdk.signPsbt(maker PSBT)
              → broker.submitSignedPsbt → maker broadcasts
              → sdk.acceptConsignment
              → resolve the dApp promise { txid, consignment }
```

See `src/types/sign-request.ts` for the exact data contract the screen consumes.

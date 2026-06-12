# CLAUDE.md — working guide for this repo

Colorex Wallet: a self-custodial RGB-on-Bitcoin **MV3 browser extension**, the
taker wallet for the Colorex RFQ exchange. Read this before changing code.

## The two-client split (do not blur it)

1. **`src/sdk/` — the `WalletSdk` interface**: the wallet's own RGB lifecycle —
   keys, balances, receive-invoices, `signPsbt`, accept-consignment. The live
   impl is `StoreWalletSdk` over the in-repo `rgb-wasm` build (`src/wallet/`), run
   as WASM in the service worker; `StubWalletSdk` is the legacy throwing stub.
2. **`src/colorex/` — the broker client**: the swap path against the Colorex
   broker (`/rfq → /accept → /sign`).

A Colorex **swap is NOT** the SDK's `sendBegin/sendEnd`. It's an RFQ atomic swap
where **the maker builds and broadcasts the PSBT**. The taker's only three SDK
touchpoints are: create an RGB invoice (`blind/witnessReceive`) → `signPsbt` the
**maker's** PSBT → `acceptConsignment`. Everything between is broker traffic. See
`docs/swap-flow.md`.

## Security core

The sign screen renders **wallet-derived `deltas`**, decoded from the maker's
PSBT in the worker — **never** amounts the dApp supplied. Treat the decode
(ROADMAP M5) as a security feature. The `SignRequest` contract is
`src/types/sign-request.ts`; see [`docs/sign-request.md`](./docs/sign-request.md).

## Design tokens

Tokens live in `src/ui/theme.ts` and atoms in `src/ui/atoms.tsx` — originally
ported from the (now-removed) design handoff, now the self-contained source of
truth. The sign screen (`src/ui/screens/SignScreen.tsx`) is the reference port
(review → signing → done). When adding screens, reuse `theme`/`atoms`, match the
tokens, and keep `prefers-reduced-motion` honored.

## Conventions

- TypeScript strict; no new runtime deps without reason. RGB runs via the in-repo
  `rgb-wasm` build, not `@utexo/rgb-sdk` (Node-only as published — never a dep).
- Styling is inline-style + the injected `cxw-*` classes (no CSS framework),
  matching the handoff.
- Popup is **380×640**; the `.cxw` shell carries tokens (`src/ui/App.tsx`).

## Public repo — guardrails

This repo is **public**; the exchange backend is a **separate private repo**.
- Never add a live dependency (submodule / git-dep) on the private repo.
- The broker API enters only as a **vendored contract**
  (`docs/colorex-broker-api.md` + `src/colorex/types.ts`), regenerated from
  rgb-rfq's OpenAPI spec (#6) once it exists.
- Keep exchange internals (maker logic, infra, keys) out of this repo.

## Commits

- Ask for the commit date before committing.
- No `Co-Authored-By` trailer.

# SignRequest — the sign-screen contract

The `SignRequest` is what the signature-approval screen consumes. The **canonical
definition is the code**: [`src/types/sign-request.ts`](../src/types/sign-request.ts).
This doc captures the intent + the security invariant; the interface is the spec.
(It supersedes §4 of the original `design_handoff_sign_tx` handoff, which has been
removed now that the contract lives in code.)

## Who builds it

The **background worker** builds the `SignRequest` by decoding the unsigned PSBT
(from the maker, via the broker) plus the RGB transfer metadata — see
[swap-flow.md](./swap-flow.md). The popup/approval window only *renders* it and
returns a `SignResult`.

## The one invariant that matters

**`deltas` are ALWAYS wallet-derived — never trusted from the dApp.** The screen
shows the *simulated outcome* (signed per-asset balance changes), computed from
the decoded PSBT + RGB metadata in the worker. This is the product's highest-trust
surface; treat the decode as a security feature, not cosmetics. The same goes for
`inputs`/`outputs`/`fee` — all derived, display-only labels.

## Shape (see the interface for the authoritative field list)

- **Identity / origin** — `id`, `origin`, `recognized` (known origin → trust pill),
  `intent`, `counterparty`, `contract`.
- **Outcome** — `deltas[]` (⭐ derived), optional `rate` (swaps), `fee`, `network`.
- **PSBT detail** — `inputs[]` / `outputs[]` (`PsbtLeg` display rows),
  `psbtBase64` (the maker's unsigned PSBT), optional `consignment`.
- **Signing** — `signInputs[]`: which PSBT inputs to sign and the exact
  `(keychain, addrIndex)` derivation, so the signer never relies on the maker's
  PSBT carrying our bip32/tap paths.
- **Correlation** — `quoteId` for the broker `/sign` call.

`SignResult` is either `{ ok: true, signedPsbt, … }` (the dApp submits it; the
maker finalizes + broadcasts) or `{ ok: false, error, … }`.

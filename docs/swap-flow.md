# Swap flow — Colorex RFQ vs the generic SDK transfer

A generic RGB SDK models a swap as `sendBegin → sign → sendEnd` "against a pool
invoice." Colorex is **not that.**

Colorex is an **RFQ atomic BTC↔RGB swap where the maker builds the PSBT and
broadcasts it.** The taker never builds or broadcasts the transfer. So the
generic `*Begin/*End` are replaced by **broker calls**:

| Generic SDK step | Colorex (rgb-rfq) reality |
|---|---|
| `sendBegin` → unsigned PSBT | `POST /rfq` (quote) → `POST /quotes/:id/accept` → **maker returns the partial PSBT** |
| decode PSBT → `SignRequest` | **same** — decode the *maker's* PSBT; the security guarantee matters more here (it's the counterparty's PSBT) |
| `signPsbt` | **same** — the one SDK call in the swap; sign the maker's PSBT |
| `sendEnd` → broadcast + consignment | `POST /quotes/:id/sign` → **maker** finalizes + broadcasts → returns consignment → wallet **accepts** it |

The taker's only three SDK touchpoints in a swap:

1. **create the RGB receive invoice** — `blindReceive` / `witnessReceive`
2. **`signPsbt`** the maker-built PSBT
3. **`acceptConsignment`** (or `refreshWallet`) to absorb the bought RGB

## Buy flow (taker buys RGB, pays BTC)

```
wallet                          broker / maker
  blindReceive(asset, amt) ─────────────────────────────►  (taker RGB invoice)
  POST /rfq {base, quote, Buy, amount} ─────────────────►  quotes[]
  POST /quotes/:id/accept
       { leg: { side:"buy", rgb_invoice, btc_funding_addr } } ──►  maker builds PSBT
  ◄──────────────── SettlementIntent { AwaitingTakerSignature, transfer.partial_psbt }
  decode partial_psbt → SignRequest.deltas  (worker)
  signPsbt(partial_psbt)
  POST /quotes/:id/sign { psbt } ───────────────────────►  maker finalizes + broadcasts
  ◄──────────────── SettlementIntent { PendingBitcoinConfirm, witness_txid, final_consignment }
  acceptConsignment(final_consignment)  → RGB lands on-device
```

## Sell flow (taker sells RGB, receives BTC)

Mirror: the maker is the RGB receiver, so the taker **builds the consignment**
and submits it via `POST /quotes/:id/consignment` before signing. The maker still
builds + broadcasts the BTC side. (`SwapLeg::sell` fields — verify against
`rfq-types`; see `colorex-broker-api.md`.)

## Open questions to confirm against `rgb-lib`

1. **Consignment delivery.** Resolved: rgb-rfq's maker returns the consignment as
   a **base64 blob**, and the wallet accepts it directly via `rgb-wasm`
   (`create_transfer` / accept) — no RGB-transport pull needed.
2. **Invoice / schema interop.** Maker (rgb-ops) and wallet (rgb-lib) are both
   RGB-Tools; verify NIA consignments validate and `witnessReceive` invoices are
   accepted by the maker.
3. **Witness-vout seals.** rgb-rfq's maker already supports witness-vout receive;
   confirm `rgb-lib`'s `witnessReceive` produces a compatible invoice.

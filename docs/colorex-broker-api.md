# Colorex broker API — vendored contract

The public taker-facing surface of the Colorex broker (rgb-rfq `rfq-api`),
mirrored in `src/colorex/types.ts` + `src/colorex/client.ts`. This is a
**vendored contract**, not a live dependency. Regenerate from the broker's
OpenAPI spec once rgb-rfq issue #6 lands (ROADMAP M5).

> Verify field-for-field against `rfq-types` before relying on the sell-leg and
> the `/sign` / `/consignment` request bodies — those weren't fully captured here.

## Endpoints

| Method · path | Body | Response |
|---|---|---|
| `POST /rfq` | `CreateRfqRequest` | `Quote[]` |
| `POST /quotes/:id/accept` | `AcceptQuoteRequest` | `SettlementIntent` |
| `POST /quotes/:id/consignment` | `{ consignment: string }` *(sell side; verify)* | `SettlementIntent` |
| `POST /quotes/:id/sign` | `{ psbt: string }` *(verify)* | `SettlementIntent` |
| `GET /health` | — | `{ status: string }` |
| `GET /maker-stream` | — | WebSocket (**makers only** — not used by the wallet) |

## Enums (serde encodings)

- `BitcoinNetwork` → `"Mainnet" | "Testnet" | "Signet" | "Regtest"` (PascalCase)
- `AssetKind` → `"Btc" | "Rgb20"`
- `Side` → `"Buy" | "Sell"`
- `SettlementStatus` → `"Pending" | "Accepted" | "AwaitingConsignment" | "AwaitingTakerSignature" | "PendingBitcoinConfirm" | …` (PascalCase; confirm the full set)
- `SwapLeg` → **internally tagged on `"side"`, snake_case**

## Shapes

```jsonc
// AssetId
{ "network": "Signet", "kind": "Rgb20", "id": "rgb:eejuoPHh-…" }   // id = "btc" for kind Btc

// CreateRfqRequest  → POST /rfq
{ "base_asset": AssetId, "quote_asset": AssetId, "side": "Buy", "amount": 100 }

// Quote  (element of the /rfq response array)
{
  "quote_id": "…", "rfq_id": "…", "maker_id": "…",
  "base_asset": AssetId, "quote_asset": AssetId,
  "side": "Buy", "amount": 100, "price": 5000,
  "expires_at_ms": 0, "estimated_fee_sats": 2600,
  "fee_slippage_bps": 0,            // present on some flows — verify
  "maker_rgb_invoice": "rgb:…"      // sell side — verify
}

// AcceptQuoteRequest  → POST /quotes/:id/accept
{ "quote_id": "…", "leg": { "side": "buy", "rgb_invoice": "rgb:…", "btc_funding_addr": "tb1q…" } }
// sell leg (verify fields): { "side": "sell", "btc_payout_addr": "tb1q…", … }

// SettlementIntent  (response of accept / consignment / sign)
{
  "quote_id": "…", "maker_id": "…",
  "status": "AwaitingTakerSignature",
  "transfer": { "partial_psbt": "<base64>", "consignment": "<base64?>" },
  "expires_at_ms": 0,
  "witness_txid": "…",              // set after /sign (broadcast)
  "final_consignment": "<base64>"   // witness-extended consignment, post-broadcast
}
```

## How the wallet uses it

The buy/sell sequences are in `swap-flow.md`. In short: `/rfq` to quote, `/accept`
to get the maker's `partial_psbt` (which the worker **decodes** into the
`SignRequest`), then `/sign` to hand back the signed PSBT (the maker broadcasts).
The wallet's `signPsbt` + `acceptConsignment` (from `@utexo/rgb-sdk`) bracket the
broker calls.

// TypeScript mirror of the Colorex broker API types (rgb-rfq `rfq-types`).
// This is a VENDORED CONTRACT, not a live dependency — see docs/colorex-broker-api.md.
// Regenerate from an OpenAPI spec once rgb-rfq issue #6 lands (ROADMAP M5).
//
// serde encodings to keep in mind:
//   BitcoinNetwork / AssetKind / Side / SettlementStatus → PascalCase variants
//   SwapLeg → internally tagged on "side", snake_case ({ "side": "buy", … })

export type BitcoinNetwork = 'Mainnet' | 'Testnet' | 'Signet' | 'Regtest'
export type AssetKind = 'Btc' | 'Rgb20'
export type Side = 'Buy' | 'Sell'

export interface AssetId {
  network: BitcoinNetwork
  kind: AssetKind
  id: string // contract id ('rgb:…') for Rgb20, 'btc' for Btc
}

export interface CreateRfqRequest {
  base_asset: AssetId
  quote_asset: AssetId
  side: Side
  amount: number
}

export interface Quote {
  quote_id: string
  rfq_id: string
  maker_id: string
  base_asset: AssetId
  quote_asset: AssetId
  side: Side
  amount: number
  price: number
  expires_at_ms: number
  estimated_fee_sats: number
  // Present on some flows — verify against rfq-types before relying on them.
  fee_slippage_bps?: number
  maker_rgb_invoice?: string
}

// Internally tagged on "side". Buy = taker buys RGB / pays BTC.
export type SwapLeg =
  | { side: 'buy'; rgb_invoice: string; btc_funding_addr: string }
  | { side: 'sell'; btc_payout_addr: string /* + sell-side fields: verify */ }

export interface AcceptQuoteRequest {
  quote_id: string
  leg: SwapLeg
}

export type SettlementStatus =
  | 'Pending'
  | 'Accepted'
  | 'AwaitingConsignment'
  | 'AwaitingTakerSignature'
  | 'PendingBitcoinConfirm'
  | string // forward-compat; verify the full set against rfq-types

export interface SwapTransfer {
  partial_psbt: string // base64, unsigned (maker-built)
  // base64. The maker returns this at /accept on BOTH legs (the buy-side consignment proves
  // the RGB the taker is buying — its ancestry). The dApp should forward it to the wallet in
  // the sign intent so the wallet can run the SPV mined-ancestry gate BEFORE signing.
  consignment?: string
  // Pre-computed witness txid of the not-yet-broadcast swap tx (the exempt hop on a buy). The
  // wallet re-derives this from the PSBT rather than trusting it.
  expected_witness_txid?: string
}

export interface SettlementIntent {
  quote_id: string
  maker_id: string
  status: SettlementStatus
  transfer?: SwapTransfer
  expires_at_ms: number
  witness_txid?: string
  final_consignment?: string // witness-extended consignment, post-broadcast
}

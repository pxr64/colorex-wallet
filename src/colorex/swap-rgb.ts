// The #38 delivered-value gate, as a PURE function — the wallet-derived RGB side of a swap
// sign request, with the chain/stock reads injected so it's unit-testable without wasm or
// chrome. `buildSignRequest` wires the real readers; tests pass stubs.
//
// Trust model: nothing dApp-claimed reaches the confirmation's RGB row for a real swap.
//   • BUY  (BTC out, an owned k10 RGB receive output) → RGB shown = the maker consignment's
//     delivery to OUR seals. Delivers nothing verifiable (no consignment / wrong seal → 0)
//     ⇒ THROW (refuse to sign): closes the A1 fail-open.
//   • SELL (spending our own k10 RGB anchors) → RGB at those anchors is valued from our own
//     stock; net parted-with = gross − change-back (read from the same consignment, which
//     holds both legs). No consignment while spending anchors ⇒ show the full at-risk amount
//     + a loud warning (not a hard block — the user is the final approver).
//   • Plain BTC send (no k10 in/out) → untouched.

import type { DecodedPsbt } from './sign-request'
import { formatUnits } from '../wallet/units'

/** A consignment's delivery to a given set of our seals (from `consignment_delivery_to_me`). */
export type DeliveryReader = (
  consignmentB64: string,
  mySeals: string[],
  network: string,
) => Promise<{ contractId: string; ticker: string; precision: number; amount: number }>

/** The RGB assets (+ balances) the wallet holds at given outpoints (from `rgbAtOutpoints`). */
export type AnchorReader = (
  outpoints: string[],
) => Promise<Array<{ contractId: string; ticker: string; precision: number; balance: number }>>

export interface SwapRgbDeps {
  delivery: DeliveryReader
  anchors: AnchorReader
}

export interface SwapRgbIntent {
  consignment?: string
  assetId?: string
  amount?: number
}

/** The base (dApp-hint) RGB display values, already resolved by the caller. Overridden with
 *  wallet-derived figures for a real swap. */
export interface SwapRgbBase {
  assetTicker: string
  assetPrecision: number
  contractId: string
  rgbAmountRaw: number
}

export interface SwapRgbResult extends SwapRgbBase {
  side: 'buy' | 'sell'
  warning?: string
}

const k10Seals = (d: DecodedPsbt) =>
  d.outputs.filter((o) => o.ours && o.keychain === 10).map((o) => `${d.txid}:${o.vout}`)

/** Resolve the wallet-derived RGB side of a swap. Throws to REFUSE a buy that delivers no
 *  verifiable RGB to us. See module header for the full trust model. */
export async function deriveSwapRgb(
  decoded: DecodedPsbt,
  intent: SwapRgbIntent,
  network: string,
  base: SwapRgbBase,
  deps: SwapRgbDeps,
): Promise<SwapRgbResult> {
  const side: 'buy' | 'sell' = decoded.btcDeltaSats < 0 ? 'buy' : 'sell'
  let { assetTicker, assetPrecision, contractId, rgbAmountRaw } = base
  let warning: string | undefined

  // BUY: an owned k10 receive output means we're getting RGB (a plain BTC send has none →
  // untouched). The amount MUST come from the consignment's delivery to our seals.
  const receiveSeals = k10Seals(decoded)
  if (side === 'buy' && receiveSeals.length > 0) {
    const delivery = intent.consignment ? await deps.delivery(intent.consignment, receiveSeals, network) : null
    if (!delivery || delivery.amount === 0) {
      throw new Error(
        'refusing to sign a buy: the maker consignment delivers no verifiable RGB to your wallet ' +
          '(missing consignment, or it pays a seal you do not own)',
      )
    }
    assetTicker = delivery.ticker
    assetPrecision = delivery.precision
    contractId = delivery.contractId
    rgbAmountRaw = delivery.amount
  }

  // SELL: spending our own k10 anchors. Value the RGB at risk from our own stock.
  const spentAnchors = decoded.inputs.filter((i) => i.ours && i.keychain === 10).map((i) => i.outpoint)
  if (side === 'sell' && spentAnchors.length > 0) {
    const atRisk = await deps.anchors(spentAnchors)
    const grossSpent = atRisk.reduce((n, a) => n + a.balance, 0)
    const a0 = atRisk[0]
    if (a0) {
      assetTicker = a0.ticker
      assetPrecision = a0.precision
      contractId = a0.contractId
    }
    if (intent.consignment) {
      // The consignment holds both legs; its delivery to OUR seals is the change back.
      const changeSeals = k10Seals(decoded)
      const change = changeSeals.length > 0 ? await deps.delivery(intent.consignment, changeSeals, network) : null
      rgbAmountRaw = Math.max(0, grossSpent - (change?.amount ?? 0))
    } else {
      // No consignment to verify the swap, yet spending anchors: surface the full at-risk
      // amount + warn loudly (gap A3: the dApp must forward the consignment pre-sign).
      rgbAmountRaw = grossSpent
      warning =
        `This swap spends RGB anchors holding ${formatUnits(grossSpent, assetPrecision)} ${assetTicker}, but no ` +
        `consignment was provided to verify what you receive in return. The wallet cannot confirm any of it ` +
        `comes back — signing risks draining the full amount. Only proceed if you trust this site and expect this exact sale.`
    }
  }

  return { side, assetTicker, assetPrecision, contractId, rgbAmountRaw, warning }
}

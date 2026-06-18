// Wallet-derived RGB (fungible-token) movement + verification for ANY signable tx — not just
// swaps. Given the decoded PSBT and (optionally) a maker consignment, it computes how much of
// our RGB moves and flags what it can't verify. A PURE function with the chain/stock reads
// injected, so it's unit-testable without wasm or chrome; `buildSignRequest` wires the real
// readers, tests pass stubs. (This is the #38 delivered-value check, generalized.)
//
// NO buy/sell trade-type — those are dApp concepts. The wallet reasons in VALUE FLOWS it
// derives itself, and nothing dApp-claimed reaches the confirmation's RGB row:
//   • rgbIn  = the consignment's delivery to OUR own seals (k10 receive outputs).
//   • rgbOut = the RGB at OUR own anchors (k10 inputs) the tx spends, valued from our stock.
//   • rgbDelta = rgbIn − rgbOut  (signed: + received, − spent) — what we show; user confirms.
// We never hard-refuse (the user is the final approver); we WARN loudly on anything we can't
// verify:
//   • spending anchors with no consignment → can't confirm what comes back (at-risk = rgbOut).
//   • paying BTC into a receive seal the consignment doesn't fund → may receive nothing.
// A plain BTC send (no owned k10 in/out) moves no RGB → rgbDelta 0, no warning.

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

export interface RgbDeltaDeps {
  delivery: DeliveryReader
  anchors: AnchorReader
}

export interface RgbDeltaIntent {
  consignment?: string
  assetId?: string
}

/** Display labels for the RGB asset (from the dApp hint / wallet registry). Overridden with
 *  wallet-derived values once an RGB movement is detected; they only label the row. */
export interface RgbDeltaBase {
  assetTicker: string
  assetPrecision: number
  contractId: string
}

export interface RgbDeltaResult extends RgbDeltaBase {
  /** Signed wallet-derived RGB movement, raw units: + net received, − net spent. */
  rgbDeltaRaw: number
  warning?: string
}

const k10Receives = (d: DecodedPsbt) =>
  d.outputs.filter((o) => o.ours && o.keychain === 10).map((o) => `${d.txid}:${o.vout}`)

/** Resolve the wallet-derived RGB movement of a sign request. See module header. */
export async function deriveRgbDelta(
  decoded: DecodedPsbt,
  intent: RgbDeltaIntent,
  network: string,
  base: RgbDeltaBase,
  deps: RgbDeltaDeps,
): Promise<RgbDeltaResult> {
  let { assetTicker, assetPrecision, contractId } = base
  let warning: string | undefined
  let rgbInRaw = 0
  let rgbOutRaw = 0

  const receiveSeals = k10Receives(decoded) // RGB arriving on our own seals
  const spentAnchors = decoded.inputs.filter((i) => i.ours && i.keychain === 10).map((i) => i.outpoint)
  const payingBtc = decoded.btcDeltaSats < 0

  // RGB IN — what the consignment delivers to our own receive seals. Filtering to our seals
  // means a delivery to a seal we don't own contributes 0.
  if (receiveSeals.length > 0) {
    const delivery = intent.consignment ? await deps.delivery(intent.consignment, receiveSeals, network) : null
    if (delivery && delivery.amount > 0) {
      rgbInRaw = delivery.amount
      assetTicker = delivery.ticker
      assetPrecision = delivery.precision
      contractId = delivery.contractId
    } else if (payingBtc) {
      // We pay BTC and the tx pays RGB to our seal, but no consignment confirms any arriving:
      // we may receive nothing. Warn (the user is the final approver).
      warning =
        'You are paying BTC, but no consignment confirms any RGB arriving at your wallet — you may ' +
        'receive nothing in return. Only proceed if you trust this site and expect this exact purchase.'
    }
  }

  // RGB OUT — what we spend from our own anchors, valued from our stock. Only act if the spent
  // k10 inputs actually carry RGB (`grossSpent > 0`); spending non-RGB k10 dust is inert.
  if (spentAnchors.length > 0) {
    const atRisk = await deps.anchors(spentAnchors)
    const grossSpent = atRisk.reduce((n, a) => n + a.balance, 0)
    if (grossSpent > 0) {
      rgbOutRaw = grossSpent
      const a0 = atRisk[0]
      if (a0) {
        assetTicker = a0.ticker
        assetPrecision = a0.precision
        contractId = a0.contractId
      }
      if (!intent.consignment) {
        // No consignment to verify what comes back, yet we're spending RGB anchors: surface
        // the full at-risk amount + warn loudly (gap A3: the dApp must forward the consignment
        // pre-sign). The change, when present, would offset this via the rgbIn read above.
        warning =
          `This transaction spends RGB anchors holding ${formatUnits(grossSpent, assetPrecision)} ${assetTicker}, but no ` +
          `consignment was provided to verify what you receive in return. The wallet cannot confirm any of it comes back ` +
          `— signing risks draining the full amount. Only proceed if you trust this site and expect this exact transfer.`
      }
    }
  }

  return { assetTicker, assetPrecision, contractId, rgbDeltaRaw: rgbInRaw - rgbOutRaw, warning }
}

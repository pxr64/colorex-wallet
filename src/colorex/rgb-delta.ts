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
import type { SignFinding } from '../types/sign-request'
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
  /** Severity-tagged findings (0..n) from the value-flow analysis. A `block` disables Sign — a
   *  visible buy (paying BTC) with no good delivery to our seals, or a graph-invalid consignment;
   *  a `warn` is advisory — spending our RGB anchors with no consignment to verify what returns. */
  findings: SignFinding[]
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
  const findings: SignFinding[] = []
  let rgbInRaw = 0
  let rgbOutRaw = 0

  const receiveSeals = k10Receives(decoded) // RGB arriving on our own seals
  const spentAnchors = decoded.inputs.filter((i) => i.ours && i.keychain === 10).map((i) => i.outpoint)
  const payingBtc = decoded.btcDeltaSats < 0

  // RGB IN — what the consignment delivers to our own receive seals (a delivery to a seal we don't
  // own contributes 0). When we PAY BTC against RGB landing on our seals, anything short of a VALID
  // consignment that actually delivers to us is a BLOCK — we can't see what we're buying otherwise.
  if (receiveSeals.length > 0) {
    let delivery: Awaited<ReturnType<DeliveryReader>> | null = null
    let invalidConsignment = false
    if (intent.consignment) {
      try {
        delivery = await deps.delivery(intent.consignment, receiveSeals, network)
      } catch (e) {
        // A2: the consignment failed RGB graph validation (commitments/schema/seal-closing). When
        // we're paying BTC against it, that's a hard block pre-sign (mirror the node's two-pass
        // gate). Off the buy path (no BTC out) our money isn't at stake pre-sign, so don't block.
        invalidConsignment = true
        if (payingBtc) {
          findings.push({
            severity: 'block',
            title: 'RGB consignment is invalid',
            detail: `The RGB consignment failed validation (${(e as Error).message}). Signing is blocked for your safety.`,
          })
        }
      }
    }
    if (delivery && delivery.amount > 0) {
      rgbInRaw = delivery.amount
      assetTicker = delivery.ticker
      assetPrecision = delivery.precision
      contractId = delivery.contractId
    } else if (payingBtc && !invalidConsignment) {
      // Paying BTC with RGB landing on our seal, but no consignment confirms any arriving (absent,
      // or it delivers nothing to our seals) → we may receive nothing → BLOCK. The user cannot
      // override an objective "nothing verifiably comes back". (A1 / the #38 delivered-value gate.)
      findings.push({
        severity: 'block',
        title: 'No RGB delivery to your wallet',
        detail:
          'You are paying BTC, but no consignment confirms RGB arriving at your wallet — you may ' +
          'receive nothing in return. Signing is blocked for your safety.',
      })
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
        // No consignment to verify what comes back, yet we're spending RGB anchors. Only the user
        // knows if this transfer is intended (e.g. a legitimate send), so this is a WARN, not a
        // block — they stay the final approver. The change, when present, offsets via rgbIn above.
        findings.push({
          severity: 'warn',
          title: 'RGB couldn’t be fully verified',
          detail:
            `This transaction spends RGB anchors holding ${formatUnits(grossSpent, assetPrecision)} ${assetTicker}, but no ` +
            `consignment was provided to verify what you receive in return. The wallet cannot confirm any of it comes back ` +
            `— signing risks draining the full amount. Only proceed if you trust this site and expect this exact transfer.`,
        })
      }
    }
  }

  return { assetTicker, assetPrecision, contractId, rgbDeltaRaw: rgbInRaw - rgbOutRaw, findings }
}

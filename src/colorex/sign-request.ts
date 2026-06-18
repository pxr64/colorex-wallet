// Assemble the SignRequest the approval screen renders, from the DECODED maker
// PSBT (wallet-derived BTC side — see rgb-wasm decode_psbt) plus the quote (the
// RGB amount the wallet asked for, validated later on consignment-accept). Every
// number here is wallet-derived; nothing is taken from the dApp.

import type { BalanceDelta, PsbtLeg, SignInput, SignRequest } from '../types/sign-request'

export interface DecodedPsbt {
  /** The unsigned tx's id == the eventual on-chain witness txid. Wallet-derived exempt for
   *  the SPV pre-sign gate (the not-yet-broadcast swap tx). */
  txid: string
  feeSats: number
  btcDeltaSats: number
  btcInOursSats: number
  btcOutOursSats: number
  totalInSats: number
  totalOutSats: number
  inputs: Array<{ outpoint: string; valueSats: number; ours: boolean; keychain?: number; index?: number }>
  outputs: Array<{ valueSats: number; ours: boolean }>
  // Explicit instructions for the signer: sign psbt input `index` with the key at
  // (keychain, addrIndex). Derived by matching each input's prev scriptPubkey to a
  // wallet address — not from PSBT-embedded derivation (which the maker may omit).
  signInputs: SignInput[]
}

export interface AssembleParams {
  id: string
  origin: string
  recognized: boolean
  network: string
  decoded: DecodedPsbt
  psbtBase64: string
  quoteId?: string
  makerId?: string
  contractId: string
  assetTicker: string
  assetPrecision: number
  rgbAmountRaw: number // quote amount in raw units (precision applied for display)
  side: 'buy' | 'sell'
  /** The maker's RGB consignment (base64), if the dApp forwarded it. Drives the SPV
   *  pre-sign mined-ancestry gate in the worker. */
  consignment?: string
}

const toBtc = (sats: number) => sats / 1e8

/** Approximate fee rate (sat/vB) from the total fee and an estimated vsize.
 *  The exact vsize needs the final witnesses (not present in a partial PSBT),
 *  so this estimates a taproot tx: ~10.5 overhead + ~57.5/P2TR input + ~43/output. */
function estimateRateSatVb(d: DecodedPsbt): number {
  const vbytes = Math.ceil(10.5 + d.inputs.length * 57.5 + d.outputs.length * 43)
  return vbytes > 0 ? Math.max(1, Math.round(d.feeSats / vbytes)) : 0
}
const sats = (n: number) => `${n.toLocaleString('en-US')} sats`

export function assembleSignRequest(p: AssembleParams): SignRequest {
  const sign = p.side === 'buy' ? 1 : -1
  const rgbDisplay = (sign * p.rgbAmountRaw) / 10 ** p.assetPrecision

  // The simulated outcome — the wallet's net position change.
  const deltas: BalanceDelta[] = [
    { sym: p.assetTicker, delta: rgbDisplay, usd: 0, isRgb: true },
    { sym: 'tBTC', delta: toBtc(p.decoded.btcDeltaSats), usd: 0, isRgb: false },
  ]

  const inputs: PsbtLeg[] = p.decoded.inputs.map((i) => ({
    label: i.ours ? 'Your input' : 'Maker input',
    detail: i.outpoint,
    amount: sats(i.valueSats),
  }))
  const outputs: PsbtLeg[] = p.decoded.outputs.map((o, idx) => ({
    label: o.ours ? 'Change → you' : `Output #${idx}`,
    detail: o.ours ? 'your address' : 'counterparty',
    amount: sats(o.valueSats),
  }))

  return {
    id: p.id,
    origin: p.origin,
    recognized: p.recognized,
    action: 'Sign transaction',
    intent: 'Swap on Colorex',
    counterparty: p.makerId,
    contract: { kind: 'RGB-20 transfer', id: p.contractId },
    deltas,
    fee: { rateSatVb: estimateRateSatVb(p.decoded), btc: toBtc(p.decoded.feeSats), usd: 0 },
    network: p.network,
    inputs,
    outputs,
    psbtBase64: p.psbtBase64,
    quoteId: p.quoteId,
    signInputs: p.decoded.signInputs,
    consignment: p.consignment,
    // Wallet-DERIVED swap txid (from the PSBT), the exempt witness for the SPV gate.
    swapTxid: p.decoded.txid,
  }
}

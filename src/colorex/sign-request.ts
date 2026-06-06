// Assemble the SignRequest the approval screen renders, from the DECODED maker
// PSBT (wallet-derived BTC side — see rgb-wasm decode_psbt) plus the quote (the
// RGB amount the wallet asked for, validated later on consignment-accept). Every
// number here is wallet-derived; nothing is taken from the dApp.

import type { BalanceDelta, PsbtLeg, SignInput, SignRequest } from '../types/sign-request'

export interface DecodedPsbt {
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
}

const toBtc = (sats: number) => sats / 1e8
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
    fee: { rateSatVb: 0, btc: toBtc(p.decoded.feeSats), usd: 0 },
    network: p.network,
    inputs,
    outputs,
    psbtBase64: p.psbtBase64,
    quoteId: p.quoteId,
    signInputs: p.decoded.signInputs,
  }
}

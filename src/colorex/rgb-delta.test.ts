import { describe, expect, it } from 'vitest'
import { deriveRgbDelta, type RgbDeltaDeps, type RgbDeltaResult } from './rgb-delta'
import type { DecodedPsbt } from './sign-request'

const TXID = 'aa'.repeat(32)

// A decoded PSBT with the given ours+k10 inputs/outputs. `btcDeltaSats < 0` = paying BTC.
function decoded(opts: {
  btcDeltaSats: number
  k10Inputs?: string[] // spent anchor outpoints
  k10OutVouts?: number[] // our k10 receive/change output vouts
}): DecodedPsbt {
  const inputs = (opts.k10Inputs ?? []).map((outpoint) => ({ outpoint, valueSats: 0, ours: true, keychain: 10, index: 0 }))
  const outputs = (opts.k10OutVouts ?? []).map((vout) => ({ valueSats: 0, ours: true, vout, keychain: 10, index: 0 }))
  return {
    txid: TXID,
    feeSats: 0,
    btcDeltaSats: opts.btcDeltaSats,
    btcInOursSats: 0,
    btcOutOursSats: 0,
    totalInSats: 0,
    totalOutSats: 0,
    inputs,
    outputs,
    signInputs: [],
  }
}

const base = { assetTicker: 'DAPP', assetPrecision: 0, contractId: 'rgb:dapp' }

function deps(over: Partial<RgbDeltaDeps> = {}): RgbDeltaDeps {
  return {
    delivery: async () => ({ contractId: 'rgb:real', ticker: 'REAL', precision: 2, amount: 1500 }),
    anchors: async () => [{ contractId: 'rgb:real', ticker: 'REAL', precision: 2, balance: 2000 }],
    ...over,
  }
}

const block = (r: RgbDeltaResult) => r.findings.find((f) => f.severity === 'block')
const warn = (r: RgbDeltaResult) => r.findings.find((f) => f.severity === 'warn')

// RGB arriving on our seals (a "buy"-shaped flow: pay BTC, receive RGB).
describe('deriveRgbDelta — RGB in', () => {
  it('shows +delivery to our seals, wallet-derived (not the dApp hint)', async () => {
    const r = await deriveRgbDelta(decoded({ btcDeltaSats: -5000, k10OutVouts: [1] }), { consignment: 'cons' }, 'signet', base, deps())
    expect(r.rgbDeltaRaw).toBe(1500) // + received
    expect(r.contractId).toBe('rgb:real')
    expect(r.assetTicker).toBe('REAL')
    expect(r.findings).toEqual([])
  })

  it('passes the wallet-derived k10 receive seal (<txid>:<vout>) to the delivery reader', async () => {
    let seenSeals: string[] = []
    await deriveRgbDelta(
      decoded({ btcDeltaSats: -1, k10OutVouts: [2] }),
      { consignment: 'cons' },
      'signet',
      base,
      deps({ delivery: async (_c, seals) => ((seenSeals = seals), { contractId: 'rgb:real', ticker: 'REAL', precision: 2, amount: 10 }) }),
    )
    expect(seenSeals).toEqual([`${TXID}:2`])
  })

  it('BLOCKS when paying BTC into a receive seal with no consignment', async () => {
    const r = await deriveRgbDelta(decoded({ btcDeltaSats: -5000, k10OutVouts: [1] }), {}, 'signet', base, deps())
    expect(r.rgbDeltaRaw).toBe(0)
    expect(block(r)?.detail).toMatch(/receive nothing/)
  })

  it('BLOCKS when the consignment delivers 0 to our seals (wrong seal) while paying BTC', async () => {
    const r = await deriveRgbDelta(
      decoded({ btcDeltaSats: -5000, k10OutVouts: [1] }),
      { consignment: 'cons' },
      'signet',
      base,
      deps({ delivery: async () => ({ contractId: 'rgb:real', ticker: 'REAL', precision: 2, amount: 0 }) }),
    )
    expect(r.rgbDeltaRaw).toBe(0)
    expect(block(r)?.detail).toMatch(/receive nothing/)
  })

  it('BLOCKS (A2) when the consignment fails graph validation (delivery throws) while paying BTC', async () => {
    const r = await deriveRgbDelta(
      decoded({ btcDeltaSats: -5000, k10OutVouts: [1] }),
      { consignment: 'cons' },
      'signet',
      base,
      deps({
        delivery: async () => {
          throw new Error('mpc commitment mismatch')
        },
      }),
    )
    expect(r.rgbDeltaRaw).toBe(0)
    expect(block(r)?.title).toMatch(/invalid/i)
    expect(block(r)?.detail).toMatch(/mpc commitment mismatch/)
  })

  it('leaves a plain BTC send (BTC out, no k10 in/out) untouched — 0 RGB, no findings', async () => {
    const r = await deriveRgbDelta(decoded({ btcDeltaSats: -5000 }), {}, 'signet', base, deps())
    expect(r.rgbDeltaRaw).toBe(0)
    expect(r.findings).toEqual([])
    expect(r.contractId).toBe('rgb:dapp')
  })
})

// RGB leaving via our anchors (a "sell"-shaped flow) — direction-independent.
describe('deriveRgbDelta — RGB out', () => {
  it('shows the NET (−(gross − change)) when the consignment is present', async () => {
    const r = await deriveRgbDelta(
      decoded({ btcDeltaSats: +5000, k10Inputs: [`${TXID}:0`], k10OutVouts: [1] }),
      { consignment: 'cons' },
      'signet',
      base,
      deps({
        anchors: async () => [{ contractId: 'rgb:real', ticker: 'REAL', precision: 2, balance: 2000 }],
        delivery: async () => ({ contractId: 'rgb:real', ticker: 'REAL', precision: 2, amount: 500 }), // change back
      }),
    )
    expect(r.rgbDeltaRaw).toBe(-1500) // 500 in (change) − 2000 out (gross)
    expect(r.findings).toEqual([])
    expect(r.assetTicker).toBe('REAL')
  })

  it('shows −gross + a loud WARN when spending anchors with no consignment', async () => {
    const r = await deriveRgbDelta(
      decoded({ btcDeltaSats: +5000, k10Inputs: [`${TXID}:0`] }),
      {},
      'signet',
      base,
      deps({ anchors: async () => [{ contractId: 'rgb:real', ticker: 'REAL', precision: 2, balance: 2000 }] }),
    )
    expect(r.rgbDeltaRaw).toBe(-2000)
    expect(warn(r)?.detail).toMatch(/risks draining/)
    expect(warn(r)?.detail).toMatch(/20(\.00)?/) // 2000 raw at precision 2 → "20"
  })

  it('WARNS on a BTC-OUT tx that spends anchors with no consignment (no buy/sell to dodge it)', async () => {
    const r = await deriveRgbDelta(
      decoded({ btcDeltaSats: -5000, k10Inputs: [`${TXID}:0`] }),
      {},
      'signet',
      base,
      deps({ anchors: async () => [{ contractId: 'rgb:real', ticker: 'REAL', precision: 2, balance: 2000 }] }),
    )
    expect(r.rgbDeltaRaw).toBe(-2000)
    expect(warn(r)?.detail).toMatch(/risks draining/)
  })

  it('does NOT touch RGB when the spent k10 inputs carry no RGB', async () => {
    const r = await deriveRgbDelta(
      decoded({ btcDeltaSats: +5000, k10Inputs: [`${TXID}:0`] }),
      {},
      'signet',
      base,
      deps({ anchors: async () => [] }),
    )
    expect(r.rgbDeltaRaw).toBe(0)
    expect(r.findings).toEqual([])
  })

  it('leaves a plain BTC receive (BTC in, no k10 anchor spent) untouched', async () => {
    const r = await deriveRgbDelta(decoded({ btcDeltaSats: +5000 }), {}, 'signet', base, deps())
    expect(r.rgbDeltaRaw).toBe(0)
    expect(r.findings).toEqual([])
  })
})

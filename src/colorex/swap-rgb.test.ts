import { describe, expect, it } from 'vitest'
import { deriveSwapRgb, type SwapRgbDeps } from './swap-rgb'
import type { DecodedPsbt } from './sign-request'

const TXID = 'aa'.repeat(32)

// A decoded PSBT with the given ours+k10 inputs/outputs. `btcDeltaSats < 0` = buy.
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

const base = { assetTicker: 'DAPP', assetPrecision: 0, contractId: 'rgb:dapp', rgbAmountRaw: 999 }

// Readers that record their calls and return canned values.
function deps(over: Partial<SwapRgbDeps> = {}): SwapRgbDeps {
  return {
    delivery: async () => ({ contractId: 'rgb:real', ticker: 'REAL', precision: 2, amount: 1500 }),
    anchors: async () => [{ contractId: 'rgb:real', ticker: 'REAL', precision: 2, balance: 2000 }],
    ...over,
  }
}

describe('deriveSwapRgb — buy', () => {
  it('derives the RGB row from the consignment delivery, not the dApp hint', async () => {
    const r = await deriveSwapRgb(decoded({ btcDeltaSats: -5000, k10OutVouts: [1] }), { consignment: 'cons' }, 'signet', base, deps())
    expect(r.side).toBe('buy')
    expect(r.rgbAmountRaw).toBe(1500) // wallet-derived, NOT base.rgbAmountRaw (999)
    expect(r.contractId).toBe('rgb:real')
    expect(r.assetTicker).toBe('REAL')
    expect(r.warning).toBeUndefined()
  })

  it('passes the wallet-derived k10 receive seal (<txid>:<vout>) to the delivery reader', async () => {
    let seenSeals: string[] = []
    await deriveSwapRgb(
      decoded({ btcDeltaSats: -1, k10OutVouts: [2] }),
      { consignment: 'cons' },
      'signet',
      base,
      deps({ delivery: async (_c, seals) => ((seenSeals = seals), { contractId: 'rgb:real', ticker: 'REAL', precision: 2, amount: 10 }) }),
    )
    expect(seenSeals).toEqual([`${TXID}:2`])
  })

  it('REFUSES a buy with no consignment (closes the A1 fail-open)', async () => {
    await expect(
      deriveSwapRgb(decoded({ btcDeltaSats: -5000, k10OutVouts: [1] }), {}, 'signet', base, deps()),
    ).rejects.toThrow(/refusing to sign a buy/)
  })

  it('REFUSES a buy whose consignment delivers 0 to our seals (wrong seal)', async () => {
    await expect(
      deriveSwapRgb(
        decoded({ btcDeltaSats: -5000, k10OutVouts: [1] }),
        { consignment: 'cons' },
        'signet',
        base,
        deps({ delivery: async () => ({ contractId: 'rgb:real', ticker: 'REAL', precision: 2, amount: 0 }) }),
      ),
    ).rejects.toThrow(/refusing to sign a buy/)
  })

  it('leaves a plain BTC send (BTC out, no k10 output) untouched — no throw, no override', async () => {
    const r = await deriveSwapRgb(decoded({ btcDeltaSats: -5000 }), {}, 'signet', base, deps())
    expect(r.side).toBe('buy')
    expect(r.rgbAmountRaw).toBe(999) // base preserved
    expect(r.contractId).toBe('rgb:dapp')
  })
})

describe('deriveSwapRgb — sell', () => {
  it('shows the NET parted-with (gross spent − change) when the consignment is present', async () => {
    const r = await deriveSwapRgb(
      decoded({ btcDeltaSats: +5000, k10Inputs: [`${TXID}:0`], k10OutVouts: [1] }),
      { consignment: 'cons' },
      'signet',
      base,
      deps({
        anchors: async () => [{ contractId: 'rgb:real', ticker: 'REAL', precision: 2, balance: 2000 }],
        delivery: async () => ({ contractId: 'rgb:real', ticker: 'REAL', precision: 2, amount: 500 }), // change back
      }),
    )
    expect(r.side).toBe('sell')
    expect(r.rgbAmountRaw).toBe(1500) // 2000 gross − 500 change
    expect(r.warning).toBeUndefined()
    expect(r.assetTicker).toBe('REAL')
  })

  it('shows the FULL at-risk amount + a loud warning when no consignment is provided', async () => {
    const r = await deriveSwapRgb(
      decoded({ btcDeltaSats: +5000, k10Inputs: [`${TXID}:0`] }),
      {},
      'signet',
      base,
      deps({ anchors: async () => [{ contractId: 'rgb:real', ticker: 'REAL', precision: 2, balance: 2000 }] }),
    )
    expect(r.rgbAmountRaw).toBe(2000) // full gross at risk
    expect(r.warning).toMatch(/risks draining/)
    expect(r.warning).toMatch(/20(\.00)?/) // 2000 raw at precision 2 → "20"
  })

  it('leaves a plain BTC receive (BTC in, no k10 anchor spent) untouched', async () => {
    const r = await deriveSwapRgb(decoded({ btcDeltaSats: +5000 }), {}, 'signet', base, deps())
    expect(r.side).toBe('sell')
    expect(r.rgbAmountRaw).toBe(999)
    expect(r.warning).toBeUndefined()
  })
})

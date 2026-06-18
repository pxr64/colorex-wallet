import { describe, expect, it } from 'vitest'
import { BURY_DEPTH, partitionByCache } from './verified-witness-cache'

describe('partitionByCache', () => {
  const tip = 1000

  it('skips cached witnesses that are now buried ≥ BURY_DEPTH', () => {
    // height 900 → 1000-900+1 = 101 confs ≥ 100 → skip.
    const { skip, check } = partitionByCache(['x'], { x: 900 }, tip, BURY_DEPTH)
    expect(skip).toEqual(['x'])
    expect(check).toEqual([])
  })

  it('re-checks cached witnesses that are not yet buried enough', () => {
    // height 950 → 51 confs < 100 → still check.
    const { skip, check } = partitionByCache(['x'], { x: 950 }, tip, BURY_DEPTH)
    expect(skip).toEqual([])
    expect(check).toEqual(['x'])
  })

  it('checks uncached witnesses', () => {
    const { skip, check } = partitionByCache(['x', 'y'], { x: 900 }, tip, BURY_DEPTH)
    expect(skip).toEqual(['x'])
    expect(check).toEqual(['y'])
  })

  it('treats exactly BURY_DEPTH confirmations as buried (boundary inclusive)', () => {
    // confs == buryDepth → skip. tip - h + 1 == buryDepth ⇒ h = tip + 1 - buryDepth.
    const h = tip + 1 - BURY_DEPTH
    expect(partitionByCache(['x'], { x: h }, tip, BURY_DEPTH).skip).toEqual(['x'])
    expect(partitionByCache(['x'], { x: h + 1 }, tip, BURY_DEPTH).check).toEqual(['x'])
  })
})

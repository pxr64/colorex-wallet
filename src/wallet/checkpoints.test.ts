import { describe, expect, it } from 'vitest'
import { type Checkpoint, bakedCheckpoints, nearestCheckpoint } from './checkpoints'

describe('nearestCheckpoint', () => {
  const cps: Checkpoint[] = [
    { height: 0, blockHash: 'a' },
    { height: 4032, blockHash: 'c' },
    { height: 2016, blockHash: 'b' },
  ]

  it('picks the highest checkpoint at or below the height', () => {
    expect(nearestCheckpoint(cps, 3000)?.height).toBe(2016)
    expect(nearestCheckpoint(cps, 5000)?.height).toBe(4032)
    expect(nearestCheckpoint(cps, 2016)?.height).toBe(2016) // boundary inclusive
    expect(nearestCheckpoint(cps, 0)?.height).toBe(0)
  })

  it('returns null when nothing is at or below the height', () => {
    expect(nearestCheckpoint([{ height: 2016, blockHash: 'b' }], 100)).toBeNull()
    expect(nearestCheckpoint([], 999)).toBeNull()
  })
})

describe('bakedCheckpoints', () => {
  it('returns sorted, epoch-aligned signet checkpoints', () => {
    const signet = bakedCheckpoints('signet')
    expect(signet.length).toBeGreaterThan(0)
    for (let i = 1; i < signet.length; i++) {
      expect(signet[i].height).toBeGreaterThan(signet[i - 1].height) // ascending
    }
    // Every signet checkpoint sits on a 2016-block (epoch) boundary.
    for (const c of signet) expect(c.height % 2016).toBe(0)
  })

  it('is empty for unknown / regtest networks', () => {
    expect(bakedCheckpoints('regtest')).toEqual([])
    expect(bakedCheckpoints('mainnet')).toEqual([]) // table not yet generated (gap C1)
  })
})

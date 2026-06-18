import { describe, expect, it } from 'vitest'
import type { Checkpoint } from './checkpoints'
import { reconcileCheckpoints } from './checkpoint-reconcile'

const cp = (height: number, blockHash: string): Checkpoint => ({ height, blockHash })

describe('reconcileCheckpoints', () => {
  it('baked-only (no local) → effective == baked', () => {
    const baked = [cp(0, 'a'), cp(2016, 'b')]
    const r = reconcileCheckpoints(baked, [])
    expect(r.effective).toEqual(baked)
    expect(r.keptLocal).toEqual([])
  })

  it('keeps local checkpoints strictly above the highest baked (the extension tail)', () => {
    const baked = [cp(0, 'a'), cp(2016, 'b')]
    const local = [cp(4032, 'c'), cp(6048, 'd')]
    const r = reconcileCheckpoints(baked, local)
    expect(r.keptLocal).toEqual(local)
    expect(r.effective.map((c) => c.height)).toEqual([0, 2016, 4032, 6048])
  })

  it('prunes local that is redundant with baked (same height, matching hash)', () => {
    const baked = [cp(0, 'a'), cp(2016, 'b')]
    const local = [cp(2016, 'b'), cp(4032, 'c')] // 2016 duplicates baked
    const r = reconcileCheckpoints(baked, local)
    expect(r.keptLocal).toEqual([cp(4032, 'c')]) // only the tail survives
    expect(r.dropped).toContainEqual(cp(2016, 'b'))
  })

  it('baked wins a conflict and drops all local from that height up (incl. the tail)', () => {
    const baked = [cp(0, 'a'), cp(2016, 'b')]
    // local disagrees with baked at 2016 (reorg/poison/stale) → drop 2016 AND the 4032 tail.
    const local = [cp(2016, 'X'), cp(4032, 'c')]
    const r = reconcileCheckpoints(baked, local)
    expect(r.keptLocal).toEqual([])
    expect(r.dropped.map((c) => c.height)).toEqual([2016, 4032])
    expect(r.effective).toEqual(baked) // falls back to baked alone
  })

  it('a new binary with a higher baked table prunes the now-covered local + keeps only the newer tail', () => {
    // v1 had baked up to 2016 + extended locally to 8064. v2 ships baked up to 6048.
    const bakedV2 = [cp(0, 'a'), cp(2016, 'b'), cp(4032, 'c'), cp(6048, 'd')]
    const localV1 = [cp(4032, 'c'), cp(6048, 'd'), cp(8064, 'e')] // matching where they overlap
    const r = reconcileCheckpoints(bakedV2, localV1)
    expect(r.keptLocal).toEqual([cp(8064, 'e')]) // only what's above the new baked frontier
    expect(r.effective.map((c) => c.height)).toEqual([0, 2016, 4032, 6048, 8064])
  })

  it('is order-insensitive (sorts inputs)', () => {
    const baked = [cp(2016, 'b'), cp(0, 'a')]
    const local = [cp(6048, 'd'), cp(4032, 'c')]
    const r = reconcileCheckpoints(baked, local)
    expect(r.effective.map((c) => c.height)).toEqual([0, 2016, 4032, 6048])
  })
})

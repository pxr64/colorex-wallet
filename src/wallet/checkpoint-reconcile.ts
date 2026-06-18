// Reconcile the wallet's background-validated LOCAL checkpoints against the BAKED table.
//
// The baked table (compiled into the binary) is the authoritative trust root. The local store
// is a forward extension the wallet validated itself (see the background extend task) and is
// DISPOSABLE — correctness never depends on it, so "drop on any doubt" is always safe. This runs
// on every startup, which also transparently handles a new binary shipping an extended baked
// table (baked silently overrides anything local got wrong). See docs (consignment-spv-verification §9).

import type { Checkpoint } from './checkpoints'

export interface ReconcileResult {
  /** `baked ∪ kept-local`, ascending — the checkpoint set verification anchors against. */
  effective: Checkpoint[]
  /** Local checkpoints retained (the consistent tail strictly above the highest baked). */
  keptLocal: Checkpoint[]
  /** Local checkpoints discarded (redundant-vs-baked or conflicting) — the caller persists `keptLocal`. */
  dropped: Checkpoint[]
}

const byHeight = (a: Checkpoint, b: Checkpoint) => a.height - b.height

/**
 * Merge baked + local with **baked authoritative**:
 * - **Conflict** at a shared height (different hash) → drop that local checkpoint *and every
 *   local checkpoint above it* (a reorg, a poisoned store, or stale local — baked always wins).
 * - **Redundant** local at/below the highest baked height → pruned (baked covers that range).
 * - **Consistent tail** local strictly above the highest baked → kept (the forward extension;
 *   its linkage is re-checked by the background validate, not here).
 */
export function reconcileCheckpoints(baked: Checkpoint[], local: Checkpoint[]): ReconcileResult {
  const bakedSorted = [...baked].sort(byHeight)
  const localSorted = [...local].sort(byHeight)
  const bakedHashAt = new Map(bakedSorted.map((c) => [c.height, c.blockHash.toLowerCase()]))
  const highestBaked = bakedSorted.length ? bakedSorted[bakedSorted.length - 1].height : -1

  const keptLocal: Checkpoint[] = []
  const dropped: Checkpoint[] = []
  let conflicted = false

  for (const c of localSorted) {
    if (conflicted) {
      dropped.push(c) // everything above a conflict is on a divergent chain → drop
      continue
    }
    const bakedHash = bakedHashAt.get(c.height)
    if (bakedHash !== undefined) {
      if (bakedHash !== c.blockHash.toLowerCase()) {
        conflicted = true // baked disagrees here → drop from here up
      }
      dropped.push(c) // overlaps baked → redundant either way (baked is the source of truth)
      continue
    }
    if (c.height <= highestBaked) {
      dropped.push(c) // below the baked frontier but off-boundary → redundant region, prune
      continue
    }
    keptLocal.push(c) // strictly above the baked frontier → the extension tail
  }

  const effective = [...bakedSorted, ...keptLocal].sort(byHeight)
  return { effective, keptLocal, dropped }
}

// Background checkpoint extension (SPV stage 3). Grows the wallet's LOCAL checkpoint store
// forward from its current trusted frontier, so the nearest checkpoint stays ≤ one epoch below
// even recently-mined witnesses (otherwise runs grow as the chain advances past the baked table).
//
// Each call does BOUNDED work — at most one epoch (2016 blocks) — and persists, so it resumes
// safely across MV3 service-worker wakeups (the worker schedules it on a chrome.alarm). It
// validates the run in wasm (linkage [+ PoW/difficulty on mainnet]) before persisting, so a local
// checkpoint is only ever recorded if it was *validated* from an already-trusted anchor — never
// taken on a server's word. Disposable: reconcileCheckpoints drops anything inconsistent on read.

import { type Checkpoint, EPOCH, bakedCheckpoints } from './checkpoints'
import { reconcileCheckpoints } from './checkpoint-reconcile'
import { loadLocalCheckpoints, saveLocalCheckpoints } from './checkpoint-store'
import { ESPLORA_SIGNET, fetchHeaderRun, tipHeight } from './esplora'
import { rgbReady, wasm } from './rgb'

/** wasm `Checkpoint` serializes with snake_case `block_hash`; map to our camelCase shape. */
interface WasmCheckpoint {
  height: number
  block_hash: string
}

export interface ExtendResult {
  /** New checkpoints appended to the local store this call. */
  added: number
  /** The trusted frontier height after this call. */
  frontier: number
}

/**
 * Advance the local checkpoint store by at most one epoch. Returns how many checkpoints were
 * added + the new frontier. Idempotent and resumable: call repeatedly (e.g. on an alarm) until
 * `added === 0` to catch up to the tip. No-op on networks without a baked anchor (regtest).
 */
export async function extendLocalCheckpoints(
  network: string,
  base: string = ESPLORA_SIGNET,
): Promise<ExtendResult> {
  await rgbReady()
  const baked = bakedCheckpoints(network)
  const local = await loadLocalCheckpoints(network)
  const { effective, keptLocal } = reconcileCheckpoints(baked, local)
  if (effective.length === 0) return { added: 0, frontier: -1 } // no trust anchor

  const frontier = effective[effective.length - 1] // highest trusted checkpoint
  const tip = await tipHeight(base)
  const nextBoundary = frontier.height + EPOCH
  if (nextBoundary > tip) return { added: 0, frontier: frontier.height } // no full new epoch yet

  // Validate the one-epoch run from the frontier; wasm returns the epoch checkpoints in it.
  const headers = await fetchHeaderRun(frontier.height, nextBoundary, base)
  const out = wasm.extend_checkpoints(
    network,
    JSON.stringify({ height: frontier.height, block_hash: frontier.blockHash }),
    JSON.stringify(headers),
  )
  const validated = (JSON.parse(out) as WasmCheckpoint[]).map<Checkpoint>((c) => ({
    height: c.height,
    blockHash: c.block_hash,
  }))

  // Keep only genuinely-new checkpoints (above the current frontier, not already baked).
  const toAdd = validated.filter(
    (c) => c.height > frontier.height && !baked.some((b) => b.height === c.height),
  )
  if (toAdd.length === 0) return { added: 0, frontier: frontier.height }

  await saveLocalCheckpoints(network, [...keptLocal, ...toAdd])
  return { added: toAdd.length, frontier: nextBoundary }
}

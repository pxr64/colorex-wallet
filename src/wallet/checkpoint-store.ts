// Persistent store for the wallet's background-validated LOCAL checkpoints (chrome.storage.local,
// keyed by network). This is the disposable forward-extension of the baked table — always
// reconciled against baked on read (see checkpoint-reconcile). Stores only (height, hash) per
// epoch — a handful of entries, not the header chain. The background extend task (MV3 alarm)
// appends validated checkpoints here; if it never runs, the store stays empty and verification
// falls back to the baked table.

import type { Checkpoint } from './checkpoints'

const key = (network: string) => `spvCheckpoints:${network}`

/** Load the wallet's locally-validated checkpoints for `network` (empty if none yet). */
export async function loadLocalCheckpoints(network: string): Promise<Checkpoint[]> {
  const k = key(network)
  const got = await chrome.storage.local.get(k)
  return (got[k] as Checkpoint[] | undefined) ?? []
}

/** Persist the (reconciled / extended) local checkpoint set for `network`. */
export async function saveLocalCheckpoints(network: string, cps: Checkpoint[]): Promise<void> {
  await chrome.storage.local.set({ [key(network)]: cps })
}

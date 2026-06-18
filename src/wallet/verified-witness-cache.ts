// Verified-witness cache — skip re-verifying deeply-buried ancestry across trades.
//
// After an all-mined verify, record each verified witness's block height. On a later verify, a
// cached witness now ≥ BURY_DEPTH confirmations deep is trusted (reorg-safe — the same
// assumption as the maker-side `mined_bookmark`) and skipped: no merkle-proof / header fetch.
// This drops repeat-trade cost from O(full ancestry) to ~O(new witnesses). chrome.storage.local,
// per network; disposable — a miss just re-verifies, a reorg deeper than BURY_DEPTH is the
// standard SPV assumption.

/** Confirmations beyond which a verified witness is reorg-safe to cache (matches maker BURY_DEPTH). */
export const BURY_DEPTH = 100

const key = (network: string) => `spvVerified:${network}`

/** Load the txid→block-height cache of previously-verified witnesses for `network`. */
export async function loadVerifiedCache(network: string): Promise<Record<string, number>> {
  const k = key(network)
  const got = await chrome.storage.local.get(k)
  return (got[k] as Record<string, number> | undefined) ?? {}
}

/** Merge newly-verified `heights` (txid→block-height) into the cache for `network`. */
export async function recordVerified(network: string, heights: Record<string, number>): Promise<void> {
  if (Object.keys(heights).length === 0) return
  const k = key(network)
  const cur = await loadVerifiedCache(network)
  await chrome.storage.local.set({ [k]: { ...cur, ...heights } })
}

/**
 * Partition witnesses into those safe to SKIP (cached *and* now ≥ `buryDepth` confirmations) and
 * those that still need a CHECK. Pure — the testable core of the cache. `frontier` is the wallet's
 * highest VALIDATED checkpoint height — never the untrusted indexer tip, which an attacker could
 * inflate to mark shallow witnesses buried and suppress their re-verification; confirmations =
 * `frontier - height + 1`.
 */
export function partitionByCache(
  txids: string[],
  cache: Record<string, number>,
  frontier: number,
  buryDepth: number,
): { skip: string[]; check: string[] } {
  const skip: string[] = []
  const check: string[] = []
  for (const t of txids) {
    const h = cache[t]
    if (h !== undefined && frontier - h + 1 >= buryDepth) skip.push(t)
    else check.push(t)
  }
  return { skip, check }
}

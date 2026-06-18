// SPV mined-ancestry verification for the taker (RFQIP-1, dense-checkpoint path).
//
// Before signing a swap, the wallet must confirm the consignment's witness transactions are
// actually mined — not trust the broker's or an indexer's word. For each witness it picks the
// nearest baked checkpoint at/below the witness's block, fetches the short header run from that
// checkpoint up to the witness (≤ one epoch), and hands the runs (as segments) + the merkle
// proofs to the in-wasm verifier (`verify_consignment_spv_segments`). The verifier validates
// each run chains back to the trusted checkpoint (linkage [+ PoW + difficulty on mainnet]), then
// folds each merkle proof against the now-trusted header and checks depth. A lying esplora can
// only make verification *fail*, never falsely pass.
//
// Uniform across networks (network-gated: signet skips PoW/difficulty, anchoring linkage only;
// mainnet enforces them). See docs/spv-consignment-verification.md. Known gaps (fail-open if no
// consignment is supplied, graph-validation, dApp delivery) tracked in docs/spv-verification-gaps.md.

import { type Checkpoint, bakedCheckpoints, nearestCheckpoint } from './checkpoints'
import { reconcileCheckpoints } from './checkpoint-reconcile'
import { loadLocalCheckpoints, saveLocalCheckpoints } from './checkpoint-store'
import { BURY_DEPTH, loadVerifiedCache, partitionByCache, recordVerified } from './verified-witness-cache'
import { rgbReady, wasm } from './rgb'
import { ESPLORA_SIGNET, blockHashAtHeight, fetchHeaderRun, tipHeight, txMerkleProof } from './esplora'

/** One witness's failure reason, as serialized by the Rust `RejectReason` enum. */
export type RejectReason =
  | 'MissingAnchor'
  | 'UnknownHeader'
  | 'BadMerkle'
  | 'Malformed'
  | { Unmined: { confirmations: number } }
  | { AncestryTooLarge: { count: number; cap: number } }

/** The verifier's verdict (`SpvVerdict`). */
export interface SpvVerdict {
  /** True iff every checked (non-exempt) witness verified and is ≥ K deep. */
  all_mined: boolean
  /** `[witnessTxid, reason]` for each failure. */
  rejected: Array<[string, RejectReason]>
  /** How many witnesses were checked (excludes `exempt`). */
  checked: number
}

interface WitnessInclusion {
  block_hash: string
  block_height: number
  tx_index: number
  merkle_proof: string[]
}

export interface VerifyOpts {
  /** Network label (default `signet`). Selects the recommended confirmation depth K. */
  network?: string
  /** Witnesses to skip — on a buy, the not-yet-broadcast swap tx. */
  exempt?: string[]
  /** esplora base URL (default signet). */
  base?: string
  /** Override the confirmation depth K (default: network policy from wasm). */
  minConfs?: number
}

interface Segment {
  checkpoint: { height: number; block_hash: string }
  headers: string[]
}

/**
 * Verify that every witness in `witnessTxids` (except `exempt`) is mined, by anchoring each to
 * the nearest baked checkpoint and validating the bounded header run from it. Returns the
 * verdict; the caller refuses to sign on `all_mined === false`.
 *
 * Per (uncached) witness: one merkle-proof fetch + the bounded header run from its nearest
 * checkpoint (≤ one epoch). Already-verified, deeply-buried witnesses are skipped via the
 * verified-witness cache. Batched header fetch is a planned optimization (gap B1). Throws if a
 * witness sits below all baked checkpoints — the table must be extended downward to cover the
 * earliest contract genesis (gap C1).
 */
export async function verifyMinedAncestry(
  witnessTxids: string[],
  opts: VerifyOpts = {},
): Promise<SpvVerdict> {
  await rgbReady()
  const network = opts.network ?? 'signet'
  const base = opts.base ?? ESPLORA_SIGNET
  const exempt = opts.exempt ?? []
  const minConfs = opts.minConfs ?? wasm.spv_recommended_confs(network)
  // Trust floor = baked table; extend with the background-validated local checkpoints, with
  // baked authoritative. Reconcile drops conflicting/redundant local entries — persist the
  // cleaned set so a poisoned/stale store self-heals on use.
  const baked = bakedCheckpoints(network)
  const local = await loadLocalCheckpoints(network)
  const { effective: checkpoints, keptLocal } = reconcileCheckpoints(baked, local)
  if (keptLocal.length !== local.length) await saveLocalCheckpoints(network, keptLocal)
  const tip = await tipHeight(base)
  // The wallet's VALIDATED checkpoint frontier (highest height in the reconciled baked ∪ local
  // set) — the trust anchor for burial. NEVER the esplora tip: an untrusted indexer could inflate
  // that to mark shallow witnesses buried and suppress re-verification.
  const validatedFrontier = checkpoints.reduce((m, c) => Math.max(m, c.height), -1)

  // Verified-witness cache: skip witnesses already verified + now ≥ BURY_DEPTH deep (reorg-safe),
  // measured against the validated frontier (not the indexer tip). Skipped ones are exempted from
  // the wasm check; we re-verify the rest. Repeat trades thus cost ~O(new witnesses).
  const cache = await loadVerifiedCache(network)
  const { skip } = partitionByCache(witnessTxids, cache, validatedFrontier, BURY_DEPTH)
  const effectiveExempt = [...exempt, ...skip]

  // 1. Per witness (not exempt/cached): merkle proof + block hash + the checkpoint that anchors it.
  const anchors: Record<string, WitnessInclusion> = {}
  const groups = new Map<number, { cp: Checkpoint; maxHeight: number }>()
  const checkedHeights: Record<string, number> = {} // verified this run → cache on success
  for (const txid of witnessTxids) {
    if (effectiveExempt.includes(txid)) continue
    const proof = await txMerkleProof(txid, base)
    // A witness can't be mined above the chain tip; a height beyond it is a forged/misreported
    // proof. Reject (also bounds the header-run fetch, with fetchHeaderRun's cap as backstop).
    if (proof.block_height > tip)
      throw new Error(`witness ${txid} claims height ${proof.block_height} above tip ${tip} — forged proof`)
    const cp = nearestCheckpoint(checkpoints, proof.block_height)
    if (!cp) {
      throw new Error(
        `witness ${txid} at height ${proof.block_height} is below all baked checkpoints — extend the checkpoint table`,
      )
    }
    const blockHash = await blockHashAtHeight(proof.block_height, base)
    anchors[txid] = {
      block_hash: blockHash,
      block_height: proof.block_height,
      tx_index: proof.pos,
      merkle_proof: proof.merkle,
    }
    checkedHeights[txid] = proof.block_height
    const g = groups.get(cp.height)
    groups.set(cp.height, { cp, maxHeight: Math.max(proof.block_height, g?.maxHeight ?? 0) })
  }

  // 2. One segment per checkpoint: the run cp.height..(maxHeight + K), extended K=minConfs blocks
  //    past the highest witness so the run itself proves each witness's confirmation depth — depth
  //    comes from validated headers, never an external tip. Clamp to the tip (a witness within K of
  //    the tip legitimately isn't K-deep yet → transient Unmined). Segments are disjoint by
  //    construction (nearestCheckpoint picks the anchor in each witness's own epoch).
  const segments: Segment[] = []
  for (const { cp, maxHeight } of groups.values()) {
    const runTop = Math.min(maxHeight + minConfs, tip)
    const headers = await fetchHeaderRun(cp.height, runTop, base)
    segments.push({ checkpoint: { height: cp.height, block_hash: cp.blockHash }, headers })
  }

  // 3. Verify in wasm: each run validated against its trusted checkpoint, merged, merkle-checked.
  //    pack.headers is empty — the segments are the (validated) header source.
  const pack = { version: 1, network, anchors, headers: {} }
  const out = wasm.verify_consignment_spv_segments(
    JSON.stringify(witnessTxids),
    JSON.stringify(effectiveExempt),
    JSON.stringify(pack),
    JSON.stringify(segments),
    network,
    minConfs,
  )
  const verdict = JSON.parse(out) as SpvVerdict
  // Cache the witnesses we just verified mined (only those deep enough to be reorg-safe are
  // later skipped — see partitionByCache). Only on a clean verdict.
  if (verdict.all_mined) {
    await recordVerified(network, checkedHeights)
    // Advance the local checkpoint frontier from the runs we just validated — an accelerator on
    // top of the hourly extend task, so a wallet that was offline (or trading on a recent witness)
    // keeps runs ≤ one epoch and the bury-cache frontier current. Best-effort; never blocks.
    try {
      const harvested = JSON.parse(
        wasm.harvest_epoch_checkpoints_segments(JSON.stringify(segments), network),
      ) as Array<{ height: number; block_hash: string }>
      const fresh: Checkpoint[] = harvested
        .map((c) => ({ height: c.height, blockHash: c.block_hash }))
        .filter((c) => c.height > validatedFrontier && !baked.some((b) => b.height === c.height))
      if (fresh.length) await saveLocalCheckpoints(network, [...keptLocal, ...fresh])
    } catch (e) {
      console.warn('epoch-checkpoint harvest failed (non-fatal):', e)
    }
  }
  return verdict
}

/** Technical summary of why a verdict failed (for logs). */
export function describeRejections(verdict: SpvVerdict): string {
  return verdict.rejected
    .map(([txid, reason]) => `${txid.slice(0, 12)}…: ${JSON.stringify(reason)}`)
    .join('; ')
}

/** A friendly one-line explanation of a failed verdict, for the sign screen. Distinguishes
 *  not-yet-confirmed (the common, transient case) from a structural verification failure. */
export function describeMinedFailure(verdict: SpvVerdict): string {
  const unmined = verdict.rejected.filter(([, r]) => typeof r === 'object' && r !== null && 'Unmined' in r).length
  const structural = verdict.rejected.length - unmined
  if (structural === 0 && unmined > 0) {
    const txs = verdict.checked === 1 ? 'transaction' : 'transactions'
    const verb = unmined === 1 ? "isn't" : "aren't"
    return `${unmined} of ${verdict.checked} ${txs} in this asset's on-chain history ${verb} confirmed yet — the RGB may not be real. Signing is blocked until it confirms.`
  }
  return `The wallet couldn't verify this asset's on-chain history (${describeRejections(verdict)}). Signing is blocked for your safety.`
}

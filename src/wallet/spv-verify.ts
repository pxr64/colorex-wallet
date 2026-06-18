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
 * Per witness: one merkle-proof fetch + the bounded header run from its nearest checkpoint
 * (≤ one epoch). The verified-witness cache (skip already-buried txids) + batched header fetch
 * are planned follow-ups (gaps B1/B3). Throws if a witness sits below all baked checkpoints —
 * the table must be extended downward to cover the earliest contract genesis (gap C1).
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
  const checkpoints = bakedCheckpoints(network)
  const tip = await tipHeight(base)

  // 1. Per witness: merkle proof + block hash + the checkpoint that anchors its run.
  const anchors: Record<string, WitnessInclusion> = {}
  const groups = new Map<number, { cp: Checkpoint; maxHeight: number }>()
  for (const txid of witnessTxids) {
    if (exempt.includes(txid)) continue
    const proof = await txMerkleProof(txid, base)
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
    const g = groups.get(cp.height)
    groups.set(cp.height, { cp, maxHeight: Math.max(proof.block_height, g?.maxHeight ?? 0) })
  }

  // 2. One segment per checkpoint: the contiguous run cp.height..maxHeight. Segments are
  //    disjoint by construction (nearestCheckpoint picks the anchor in each witness's own epoch).
  const segments: Segment[] = []
  for (const { cp, maxHeight } of groups.values()) {
    const headers = await fetchHeaderRun(cp.height, maxHeight, base)
    segments.push({ checkpoint: { height: cp.height, block_hash: cp.blockHash }, headers })
  }

  // 3. Verify in wasm: each run validated against its trusted checkpoint, merged, merkle-checked.
  //    pack.headers is empty — the segments are the (validated) header source.
  const pack = { version: 1, network, anchors, headers: {} }
  const out = wasm.verify_consignment_spv_segments(
    JSON.stringify(witnessTxids),
    JSON.stringify(exempt),
    JSON.stringify(pack),
    JSON.stringify(segments),
    tip,
    network,
    minConfs,
  )
  return JSON.parse(out) as SpvVerdict
}

/** Human-readable summary of why a verdict failed (for logs / the sign screen). */
export function describeRejections(verdict: SpvVerdict): string {
  return verdict.rejected
    .map(([txid, reason]) => `${txid.slice(0, 12)}…: ${JSON.stringify(reason)}`)
    .join('; ')
}

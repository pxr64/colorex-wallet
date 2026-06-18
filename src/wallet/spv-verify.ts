// SPV mined-ancestry verification for the taker (RFQIP-1, Tier 1 / signet).
//
// Before signing a swap, the wallet must confirm the consignment's witness transactions are
// actually mined — not trust the broker's or an indexer's word. This self-fetches, per witness,
// its Bitcoin merkle proof + that block's header from esplora, assembles an SpvProofPack, and
// hands it to the in-wasm verifier (`verify_consignment_trusted`), which folds each merkle
// proof against the header's root and checks confirmation depth. A lying esplora can only make
// verification *fail*, never falsely pass.
//
// Tier 1 = trusted headers (esplora's, not PoW-validated). This is the right level on **signet**,
// whose blocks are signer-signed (no header PoW to validate) — and is a large step up from
// trusting a `confirmed` flag. Mainnet must use the checkpoint-validated path
// (`verify_consignment_spv` + a baked checkpoint set); the verifier core already supports it.
// See docs/spv-consignment-verification.md.

import { rgbReady, wasm } from './rgb'
import {
  ESPLORA_SIGNET,
  blockHashAtHeight,
  blockHeader,
  tipHeight,
  txMerkleProof,
} from './esplora'

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

/**
 * Verify that every witness in `witnessTxids` (except `exempt`) is mined, by self-fetching its
 * merkle proof + block header from esplora and checking locally in wasm. Returns the verdict;
 * the caller refuses to sign on `all_mined === false`.
 *
 * Cost is ~2 esplora requests per (distinct-block) witness; RGB ancestries are small. A
 * persistent verified-witness cache (skip already-confirmed-buried txids) is a planned follow-up.
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

  const tip = await tipHeight(base)

  const anchors: Record<string, WitnessInclusion> = {}
  const headers: Record<string, string> = {}
  // Cache headers by height within this call — sibling witnesses often share a block.
  const headerByHeight = new Map<number, { hash: string; header: string }>()

  for (const txid of witnessTxids) {
    if (exempt.includes(txid)) continue
    const proof = await txMerkleProof(txid, base)
    let entry = headerByHeight.get(proof.block_height)
    if (!entry) {
      const hash = await blockHashAtHeight(proof.block_height, base)
      const header = await blockHeader(hash, base)
      entry = { hash, header }
      headerByHeight.set(proof.block_height, entry)
    }
    anchors[txid] = {
      block_hash: entry.hash,
      block_height: proof.block_height,
      tx_index: proof.pos,
      merkle_proof: proof.merkle,
    }
    headers[entry.hash] = entry.header
  }

  const pack = { version: 1, network, anchors, headers }
  const out = wasm.verify_consignment_trusted(
    JSON.stringify(witnessTxids),
    JSON.stringify(exempt),
    JSON.stringify(pack),
    tip,
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

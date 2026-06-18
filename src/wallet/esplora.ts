// Esplora HTTP client — the browser's only path to chain data (Electrum is TCP,
// unreachable from the sandbox). We fetch just the witness-tx confirmation status
// (the txes themselves come from the consignment); wasm builds the WitnessOrd
// from this. Endpoint is esplora-compatible (mempool.space's signet API here).

export const ESPLORA_SIGNET = 'https://mempool.space/signet/api'

export interface TxStatus {
  confirmed: boolean
  block_height?: number
  block_time?: number
}

/** GET /tx/:txid/status — { confirmed, block_height?, block_time? }. */
export async function txStatus(txid: string, base: string = ESPLORA_SIGNET): Promise<TxStatus> {
  const res = await fetch(`${base}/tx/${txid}/status`)
  if (!res.ok) throw new Error(`esplora /tx/${txid}/status → ${res.status}`)
  return (await res.json()) as TxStatus
}

/** Like `txStatus`, but returns null when the node has never heard of the txid
 *  (404). A 404 means the tx is absent from mempool + chain — either not yet
 *  propagated (right after broadcast) or evicted/replaced. The import queue uses
 *  the distinction "seen-in-mempool, now absent" to detect a dropped witness. */
export async function txStatusOrNull(txid: string, base: string = ESPLORA_SIGNET): Promise<TxStatus | null> {
  const res = await fetch(`${base}/tx/${txid}/status`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`esplora /tx/${txid}/status → ${res.status}`)
  return (await res.json()) as TxStatus
}

export interface Utxo {
  txid: string
  vout: number
  value: number // sats
  /** false = still in the mempool (pending). Esplora's `status.confirmed`. */
  confirmed: boolean
}

/** Esplora's raw /utxo row (we keep value + the confirmed flag). */
interface EsploraUtxo {
  txid: string
  vout: number
  value: number
  status?: { confirmed?: boolean }
}

/** GET /address/:addr/utxo — the wallet's UTXOs at an address (confirmed + mempool). */
export async function addressUtxos(addr: string, base: string = ESPLORA_SIGNET): Promise<Utxo[]> {
  const res = await fetch(`${base}/address/${addr}/utxo`)
  if (!res.ok) throw new Error(`esplora /address/${addr}/utxo → ${res.status}`)
  const rows = (await res.json()) as EsploraUtxo[]
  return rows.map((u) => ({
    txid: u.txid,
    vout: u.vout,
    value: u.value,
    confirmed: u.status?.confirmed ?? false,
  }))
}

/** The witness-ord entries `RgbStock.accept_consignment` expects, for `txids`. */
export async function witnessOrds(
  txids: string[],
  base: string = ESPLORA_SIGNET,
): Promise<Array<{ txid: string; height?: number; time?: number }>> {
  return Promise.all(
    txids.map(async (txid) => {
      const s = await txStatus(txid, base)
      return s.confirmed ? { txid, height: s.block_height, time: s.block_time } : { txid }
    }),
  )
}

// --- SPV self-fetch primitives (RFQIP-1) ---------------------------------------------
// Raw esplora reads the SPV mined-ancestry verifier needs. The wallet fetches a witness's
// merkle proof + the block header itself, then verifies locally in wasm
// (`verify_consignment_spv`) — so a lying esplora can only cause a verify *failure*, never a
// false accept. Trust-tier wiring (which headers to trust, how) lands separately.

/** A tx's Bitcoin merkle-inclusion proof — esplora `GET /tx/:txid/merkle-proof`. `merkle`
 *  is the branch of sibling hashes (display-order hex); `pos` fixes left/right direction. */
export interface MerkleProof {
  block_height: number
  merkle: string[]
  pos: number
}

/** GET /tx/:txid/merkle-proof. Throws if the tx is unconfirmed/unknown (esplora 4xx). */
export async function txMerkleProof(txid: string, base: string = ESPLORA_SIGNET): Promise<MerkleProof> {
  const res = await fetch(`${base}/tx/${txid}/merkle-proof`)
  if (!res.ok) throw new Error(`esplora /tx/${txid}/merkle-proof → ${res.status}`)
  return (await res.json()) as MerkleProof
}

/** GET /block-height/:height → the block hash at that height (display-order hex). */
export async function blockHashAtHeight(height: number, base: string = ESPLORA_SIGNET): Promise<string> {
  const res = await fetch(`${base}/block-height/${height}`)
  if (!res.ok) throw new Error(`esplora /block-height/${height} → ${res.status}`)
  return (await res.text()).trim()
}

/** GET /block/:hash/header → the raw 80-byte block header as hex. */
export async function blockHeader(hash: string, base: string = ESPLORA_SIGNET): Promise<string> {
  const res = await fetch(`${base}/block/${hash}/header`)
  if (!res.ok) throw new Error(`esplora /block/${hash}/header → ${res.status}`)
  return (await res.text()).trim()
}

/** Current chain tip height — GET /blocks/tip/height. Used to compute confirmation depth. */
export async function tipHeight(base: string = ESPLORA_SIGNET): Promise<number> {
  const res = await fetch(`${base}/blocks/tip/height`)
  if (!res.ok) throw new Error(`esplora /blocks/tip/height → ${res.status}`)
  return Number((await res.text()).trim())
}

/** A contiguous run of raw 80-byte block headers (hex), heights `from..=to` inclusive — the
 *  input to the checkpoint-validated `CheckpointHeaderSource`. Stage-1 fetches per block
 *  (`/block-height` → `/block/:hash/header`); a batched `/blocks` + header-reconstruction path is
 *  the planned optimization (gap B1) to cut the request count ~10×. Runs are bounded by the
 *  checkpoint spacing (≤ one epoch). */
export async function fetchHeaderRun(
  from: number,
  to: number,
  base: string = ESPLORA_SIGNET,
): Promise<string[]> {
  if (to < from) throw new Error(`fetchHeaderRun: to (${to}) < from (${from})`)
  const headers: string[] = []
  for (let h = from; h <= to; h++) {
    const hash = await blockHashAtHeight(h, base)
    headers.push(await blockHeader(hash, base))
  }
  return headers
}

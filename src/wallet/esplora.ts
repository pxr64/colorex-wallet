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

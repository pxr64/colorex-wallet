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

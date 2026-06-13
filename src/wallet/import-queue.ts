// The consignment import queue — makes receiving RGB survive confirmation timing
// AND the MV3 service worker's short life. A consignment is enqueued PERSISTENTLY
// (IndexedDB) the moment it arrives (swap settle or a manual paste); a drain loop
// — driven by chrome.alarms + popup-open + onStartup, never setInterval (which dies
// with the worker) — accepts it into the stock and then WATCHES the witness tx:
//
//   pending → importing → tentative → confirmed        (witness mined)
//                                   → reverted          (witness seen then dropped)
//                       → failed(reason)                (accept errored; auto-retried)
//
// accept_consignment needs no unlocked SEED (no signing), but the RGB stock is now
// encrypted at rest (#1), so reading/writing it requires an unlocked SESSION. The
// drain therefore DEFERS while locked (checks `canAccessStock`): items stay queued
// at their current state — no attempt is burned — and import on the next unlock /
// popup-open. The consignment is durably persisted, so nothing is stranded; it just
// lands when the wallet is next unlocked (which it must be to see/use the RGB).
//
// PROMOTE/REVERT both mutate the stock via the binding's `update_witnesses` (overlay
// semantics — only the named witnesses change, the rest keep their ord): a mined
// witness → WitnessOrd::Mined (allocation spendable); a dropped/replaced witness →
// WitnessOrd::Archived ("excluded from state processing"), which drops the tentative
// allocation — a true revert, not just a UI flag. The queue treats received RGB as
// pending (not final) until its witness mines.

import { db, QUEUE_STORE, acceptConsignmentOrds, canAccessStock, consignmentWitnessIds, updateWitnesses } from './store'
import { txStatusOrNull } from './esplora'

export type ImportState = 'pending' | 'importing' | 'tentative' | 'confirmed' | 'reverted' | 'failed'

export interface ImportItem {
  id: string // `wit:<txid-…>` — keyed by witness txids so a re-delivery dedupes
  consignment: string // base64 blob — persisted so the import survives restarts
  network: string
  source: 'swap' | 'manual'
  state: ImportState
  witnessTxids: string[]
  seenInMempool: boolean // have we ever observed a witness in mempool/chain?
  contractId?: string
  ticker?: string
  amountRaw?: number
  error?: string
  attempts: number
  createdAt: number
  updatedAt: number
}

// Auto-retry cap: after this many failed accept attempts an item is left `failed`
// for the user to manually retry/dismiss, rather than retrying every alarm forever.
const MAX_ATTEMPTS = 8

// --- persistence (the `import-queue` object store, keyPath `id`) -----------------

async function queueStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const conn = await db()
  return conn.transaction(QUEUE_STORE, mode).objectStore(QUEUE_STORE)
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Every queue item, newest first. */
export async function getQueue(): Promise<ImportItem[]> {
  const items = await reqAsPromise((await queueStore('readonly')).getAll() as IDBRequest<ImportItem[]>)
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

async function getItem(id: string): Promise<ImportItem | undefined> {
  return reqAsPromise((await queueStore('readonly')).get(id) as IDBRequest<ImportItem | undefined>)
}

async function putItem(item: ImportItem): Promise<void> {
  await reqAsPromise((await queueStore('readwrite')).put(item))
}

/** Drop an item — terminal states (confirmed/reverted/failed) the user dismisses. */
export async function removeItem(id: string): Promise<void> {
  await reqAsPromise((await queueStore('readwrite')).delete(id))
}

/** Merge `fields` into the stored item (re-reads to avoid clobbering a concurrent
 *  write) and bump `updatedAt`. No-op if the item was removed meanwhile. */
async function patch(id: string, fields: Partial<ImportItem>): Promise<void> {
  const item = await getItem(id)
  if (!item) return
  await putItem({ ...item, ...fields, updatedAt: Date.now() })
}

// --- enqueue ---------------------------------------------------------------------

export interface EnqueueInput {
  consignment: string
  network?: string
  source?: 'swap' | 'manual'
  meta?: { contractId?: string; ticker?: string; amountRaw?: number }
}

/** Persist a consignment for import. Keyed by its witness txids, so re-delivering
 *  the same transfer dedupes onto the existing item: if it's already in flight or
 *  done we return it untouched; if it had failed/reverted we re-arm it to `pending`.
 *  Does NOT import — call `drain()` after (the worker does). */
export async function enqueue(input: EnqueueInput): Promise<ImportItem> {
  const consignment = input.consignment.trim()
  if (!consignment) throw new Error('empty consignment')
  const network = input.network ?? 'signet'
  const witnessTxids = await consignmentWitnessIds(consignment)
  const id = `wit:${witnessTxids.join('-') || consignment.slice(0, 32)}`

  const existing = await getItem(id)
  // Already absorbed or actively progressing — leave it be.
  if (existing && (existing.state === 'confirmed' || existing.state === 'tentative' || existing.state === 'importing')) {
    return existing
  }
  const now = Date.now()
  const item: ImportItem = existing
    ? { ...existing, state: 'pending', error: undefined, attempts: 0, updatedAt: now }
    : {
        id,
        consignment,
        network,
        source: input.source ?? 'manual',
        state: 'pending',
        witnessTxids,
        seenInMempool: false,
        contractId: input.meta?.contractId,
        ticker: input.meta?.ticker,
        amountRaw: input.meta?.amountRaw,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      }
  await putItem(item)
  return item
}

// --- drain (single-flight per worker lifetime) -----------------------------------

let draining: Promise<void> | null = null

/** Process the whole queue once. Single-flight: concurrent calls (alarm + popup +
 *  enqueue) coalesce onto the in-flight drain so the stock is never accepted into
 *  twice at once. */
export function drain(): Promise<void> {
  if (!draining) draining = drainOnce().finally(() => (draining = null))
  return draining
}

async function drainOnce(): Promise<void> {
  // The stock is encrypted at rest under the session key; accepting/promoting/
  // reverting all read+write it. While locked we DEFER the whole drain (no item
  // touched, no attempt burned) and retry on the next unlock / popup-open. Nothing
  // is stranded — every consignment is durably persisted in the queue.
  if (!(await canAccessStock())) return
  for (const item of await getQueue()) {
    if (item.state === 'confirmed' || item.state === 'reverted') continue
    if (item.state === 'failed' && item.attempts >= MAX_ATTEMPTS) continue
    try {
      await processItem(item)
    } catch (e) {
      await patch(item.id, { state: 'failed', error: (e as Error).message, attempts: item.attempts + 1 })
    }
  }
}

/** Advance one item: read its witnesses' chain status once, then import or watch. */
async function processItem(item: ImportItem): Promise<void> {
  const statuses = await Promise.all(item.witnessTxids.map((t) => txStatusOrNull(t)))
  const anySeen = statuses.some((s) => s !== null)
  const anyAbsent = statuses.some((s) => s === null)
  const allMined = statuses.length > 0 && statuses.every((s) => s?.confirmed)
  const seenInMempool = item.seenInMempool || anySeen

  const acceptOrds = (): Array<{ txid: string; height?: number; time?: number }> =>
    item.witnessTxids.map((txid, i) => {
      const s = statuses[i]
      return s?.confirmed ? { txid, height: s.block_height, time: s.block_time } : { txid }
    })
  const minedOrds = (): Array<{ txid: string; height?: number; time?: number }> =>
    item.witnessTxids.map((txid, i) => ({ txid, height: statuses[i]!.block_height, time: statuses[i]!.block_time }))

  // Revert: a witness we HAD seen in mempool is now gone (evicted/replaced/double-
  // spent). Only fires after we've observed it, so a not-yet-propagated broadcast
  // (absent but never seen) doesn't false-positive. We archive the dropped
  // witness(es) in the stock (overlay update → WitnessOrd::Archived), which drops
  // the tentative allocation — a true revert, not just a flag.
  if (item.seenInMempool && anyAbsent && !allMined) {
    if (item.state === 'tentative' || item.state === 'importing') {
      const archived = item.witnessTxids
        .filter((_, i) => statuses[i] === null)
        .map((txid) => ({ txid, archived: true }))
      await updateWitnesses(archived, item.network)
    }
    await patch(item.id, { state: 'reverted', seenInMempool, error: 'witness tx dropped or replaced' })
    return
  }

  switch (item.state) {
    case 'pending':
    case 'importing':
    case 'failed': {
      // Accept into the stock. Works pre-confirmation: the consignment carries the
      // witness tx, so a height-less ord is accepted as Tentative (Valid).
      await patch(item.id, { state: 'importing', seenInMempool })
      await acceptConsignmentOrds(item.consignment, acceptOrds(), item.network)
      await patch(item.id, {
        state: allMined ? 'confirmed' : 'tentative',
        seenInMempool,
        error: undefined,
        attempts: item.attempts + 1,
      })
      return
    }
    case 'tentative': {
      // Already in the stock as Tentative; promote once the witness mines via an
      // overlay update (Mined) — no need to re-accept the whole consignment.
      if (allMined) {
        await updateWitnesses(minedOrds(), item.network)
        await patch(item.id, { state: 'confirmed', seenInMempool })
      } else {
        await patch(item.id, { seenInMempool }) // keep watching
      }
      return
    }
  }
}

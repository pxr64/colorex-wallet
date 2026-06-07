// Popup → worker client for the import queue. The drain loop lives ONLY in the
// background worker (it owns the single writer to the RGB stock); the popup never
// imports directly — it asks the worker to enqueue/drain and reads queue state for
// display. Keeps the two realms from racing on the stock.

import type { ImportItem } from '../wallet/import-queue'
import type { ProviderRequest } from '../worker/messages'

interface WorkerResponse<T> {
  id: string
  ok: boolean
  result?: T
  error?: string
}

// Distributive Omit: `Omit<Union, 'id'>` collapses a discriminated union to its
// common keys, so omit per-member instead to keep each variant's own fields.
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

async function send<T>(req: WithoutId<ProviderRequest>): Promise<T> {
  const id = crypto.randomUUID()
  const resp: WorkerResponse<T> = await chrome.runtime.sendMessage({ ...req, id })
  if (!resp?.ok) throw new Error(resp?.error ?? 'worker request failed')
  return resp.result as T
}

/** The current queue (newest first) for the badge + list. */
export function getImportQueue(): Promise<ImportItem[]> {
  return send<ImportItem[]>({ kind: 'getImportQueue' })
}

/** Enqueue a pasted consignment + kick a drain; resolves once it's queued. */
export function enqueueConsignment(consignment: string): Promise<ImportItem> {
  return send<ImportItem>({ kind: 'enqueueConsignment', consignment })
}

/** Drop a terminal item (confirmed/reverted/failed) from the list. */
export function dismissImportItem(itemId: string): Promise<null> {
  return send<null>({ kind: 'dismissImportItem', itemId })
}

/** Ask the worker to drain now (e.g. on popup open / manual retry); returns the
 *  refreshed queue. */
export function drainImportQueue(): Promise<ImportItem[]> {
  return send<ImportItem[]>({ kind: 'drainImportQueue' })
}

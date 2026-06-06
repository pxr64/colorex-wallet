// The wallet store: owns the wasm RGB `Stock`, persists it to IndexedDB, and is
// the single source of truth for the UI's dynamic asset list. Keys/seed vault is
// a later milestone — for now we persist the RGB stock blobs + the (non-secret)
// descriptor so the wallet can list assets and derive addresses across reopens.

import { rgbReady, wasm } from './rgb'
import { generateWallet, type GeneratedWallet } from './keys'

export interface Asset {
  contractId: string
  ticker: string
  precision: number
  balance: number
}

/** Format a raw integer balance with `precision` decimals for display. */
export function formatUnits(raw: number, precision: number): string {
  const v = precision > 0 ? raw / Math.pow(10, precision) : raw
  return v.toLocaleString('en-US', { maximumFractionDigits: precision })
}

const DB_NAME = 'colorex-wallet'
const STORE_NAME = 'rgb'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const conn = await db()
  return new Promise((resolve, reject) => {
    const req = conn.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function kvPutAll(entries: Record<string, unknown>): Promise<void> {
  const conn = await db()
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STORE_NAME, 'readwrite')
    const os = tx.objectStore(STORE_NAME)
    for (const [k, v] of Object.entries(entries)) os.put(v, k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

type Stock = InstanceType<typeof wasm.RgbStock>
let stock: Stock | null = null

/** Whether a wallet already exists on this device. */
export async function walletExists(): Promise<boolean> {
  return (await kvGet<string>('descriptor')) !== undefined
}

/** Load the RGB stock from IndexedDB (or create a fresh one) — idempotent. */
export async function openStock(): Promise<Stock> {
  if (stock) return stock
  await rgbReady()
  const [stash, state, index] = await Promise.all([
    kvGet<Uint8Array>('stash'),
    kvGet<Uint8Array>('state'),
    kvGet<Uint8Array>('index'),
  ])
  if (stash && state && index) {
    stock = wasm.RgbStock.load(stash, state, index)
  } else {
    stock = new wasm.RgbStock()
    await persist()
  }
  return stock
}

/** Write the RGB stock through to IndexedDB. Call after every mutation. */
export async function persist(): Promise<void> {
  if (!stock) return
  const snap = stock.save()
  await kvPutAll({ stash: snap.stash, state: snap.state, index: snap.index })
}

/** Every asset the wallet holds (dynamic, from the stock). */
export async function listAssets(): Promise<Asset[]> {
  const s = await openStock()
  return JSON.parse(s.list_assets()) as Asset[]
}

/** Create a fresh wallet: generate keys (JS), init the stock (wasm), persist. */
export async function createWallet(): Promise<GeneratedWallet> {
  const w = generateWallet()
  await openStock() // ensures a stock exists + persisted
  await kvPutAll({ descriptor: w.descriptor })
  return w
}

export async function getDescriptor(): Promise<string | undefined> {
  return kvGet<string>('descriptor')
}

/** Derive a fresh keychain-10 RGB receive address. */
export async function receiveAddress(network = 'signet'): Promise<string | undefined> {
  const descriptor = await getDescriptor()
  if (!descriptor) return undefined
  await rgbReady()
  return wasm.derive_keychain10_address(descriptor, network)
}

/** Import (accept) an asset by consignment. Gated on the Esplora resolver edge —
 *  see docs/m1-wasm-spike.md (next milestone). */
export async function importAsset(_consignmentB64: string): Promise<never> {
  throw new Error('Importing assets needs the Esplora resolver — coming next. Listing held assets is live.')
}

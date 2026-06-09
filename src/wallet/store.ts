// The wallet store: owns the wasm RGB `Stock`, persists it to IndexedDB, and is
// the single source of truth for the UI's dynamic asset list. Keys/seed vault is
// a later milestone — for now we persist the RGB stock blobs + the (non-secret)
// descriptor so the wallet can list assets and derive addresses across reopens.

import { rgbReady, wasm } from './rgb'
import { generateWallet, type GeneratedWallet } from './keys'
import { decryptSeed, encryptSeed, type Vault } from './vault'
import { addressUtxos, witnessOrds, type Utxo } from './esplora'
import type { DecodedPsbt } from '../colorex/sign-request'

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
const DB_VERSION = 2
const STORE_NAME = 'rgb'
/** Object store holding the persistent consignment import queue (keyPath `id`).
 *  Added in DB v2 — see `import-queue.ts`. */
export const QUEUE_STORE = 'import-queue'

/** Open the shared wallet IndexedDB. Both the RGB stock (`rgb`, kv-shaped) and the
 *  import queue (`import-queue`, keyPath records) live here so they share one
 *  connection + version. The popup and the worker each open their own connection;
 *  IndexedDB is the only state they share (separate JS realms, separate in-memory
 *  `stock`). */
export function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(STORE_NAME)) d.createObjectStore(STORE_NAME)
      if (!d.objectStoreNames.contains(QUEUE_STORE)) d.createObjectStore(QUEUE_STORE, { keyPath: 'id' })
    }
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

// The decrypted mnemonic — held in memory while unlocked. Also mirrored into
// chrome.storage.session (memory-only, cleared when the browser/extension shuts
// down — never written to disk) so the unlocked session survives popup
// close/reopen instead of forcing a re-unlock every time. Auto-locks after
// AUTO_LOCK_MS of not being restored.
//
// SECURITY: this persists the RAW mnemonic in session storage, readable by any
// trusted extension context while unlocked. It's memory-only + trusted-contexts
// only, but not the most secure option. Planned hardening (persist a derived key
// instead of the mnemonic, idle-based/shorter auto-lock, worker-confined signing)
// is tracked in colorex-wallet#2.
let unlockedMnemonic: string | null = null

const SESSION_KEY = 'unlocked'
const AUTO_LOCK_MS = 30 * 60 * 1000 // 30 minutes

interface SessionEntry {
  mnemonic: string
  expiresAt: number
}

async function persistSession(mnemonic: string): Promise<void> {
  try {
    const entry: SessionEntry = { mnemonic, expiresAt: Date.now() + AUTO_LOCK_MS }
    await chrome.storage.session.set({ [SESSION_KEY]: entry })
  } catch {
    /* session storage unavailable — fall back to in-memory only */
  }
}

/** Restore an unlocked session persisted across popup opens. Returns true if a
 *  valid, non-expired session was found (and refreshes its sliding expiry). */
export async function restoreSession(): Promise<boolean> {
  if (unlockedMnemonic) return true
  let entry: SessionEntry | undefined
  try {
    entry = (await chrome.storage.session.get(SESSION_KEY))[SESSION_KEY] as SessionEntry | undefined
  } catch {
    return false
  }
  if (!entry || entry.expiresAt < Date.now()) {
    try {
      await chrome.storage.session.remove(SESSION_KEY)
    } catch {
      /* ignore */
    }
    return false
  }
  unlockedMnemonic = entry.mnemonic
  await openStock()
  await persistSession(entry.mnemonic) // sliding window on each restore
  return true
}

/** Whether an (encrypted) wallet already exists on this device. */
export async function walletExists(): Promise<boolean> {
  return (await kvGet<Vault>('vault')) !== undefined
}

export function isUnlocked(): boolean {
  return unlockedMnemonic !== null
}

/** Clear the in-memory seed AND the persisted session (explicit Lock). */
export function lock(): void {
  unlockedMnemonic = null
  void chrome.storage.session.remove(SESSION_KEY)
}

/** The unlocked mnemonic, for key derivation / signing. Null while locked. */
export function unlockedSeed(): string | null {
  return unlockedMnemonic
}

/** Decrypt the vault with `password` and hold the seed in memory. Returns false
 *  on a wrong password (AES-GCM auth failure) or if no wallet exists. */
export async function unlock(password: string): Promise<boolean> {
  const vault = await kvGet<Vault>('vault')
  if (!vault) return false
  try {
    unlockedMnemonic = await decryptSeed(vault, password)
    await openStock()
    await persistSession(unlockedMnemonic)
    return true
  } catch {
    return false
  }
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

// The wallet's own outpoints (`txid:vout`), by scanning its derived addresses on
// Esplora — used to filter RGB allocations down to what we actually hold.
async function ownedOutpoints(network = 'signet'): Promise<string[]> {
  const descriptor = await getDescriptor()
  if (!descriptor) return []
  await rgbReady()
  const addrs: string[] = []
  for (const keychain of [0, 1, 10]) {
    addrs.push(...(JSON.parse(wasm.derive_addresses(descriptor, network, keychain, 20)) as string[]))
  }
  const lists = await Promise.all(addrs.map((a) => addressUtxos(a).catch(() => [])))
  return lists.flat().map((u) => `${u.txid}:${u.vout}`)
}

/** Every asset the wallet holds, with balances filtered to wallet-owned UTXOs.
 *  Falls back to the unfiltered sum if the Esplora scan fails. */
export async function listAssets(): Promise<Asset[]> {
  const s = await openStock()
  try {
    const owned = await ownedOutpoints()
    return JSON.parse(s.list_assets_owned(JSON.stringify(owned))) as Asset[]
  } catch {
    return JSON.parse(s.list_assets()) as Asset[]
  }
}

export interface WalletSnapshot {
  btcSats: number
  assets: Asset[]
}

/** One Esplora scan → the wallet's BTC balance (sum of owned UTXOs) + the
 *  owned-filtered RGB assets. Used by the home screen so it scans once. */
export async function walletSnapshot(network = 'signet'): Promise<WalletSnapshot> {
  const s = await openStock()
  const tagged = await ownedAddresses(network)
  if (tagged.length === 0) {
    return { btcSats: 0, assets: JSON.parse(s.list_assets()) as Asset[] }
  }
  const lists = await Promise.all(tagged.map((t) => addressUtxos(t.address).catch(() => [] as Utxo[])))
  const utxos = lists.flat()
  const btcSats = utxos.reduce((sum, u) => sum + (u.value || 0), 0)
  const owned = utxos.map((u) => `${u.txid}:${u.vout}`)
  const assets = JSON.parse(s.list_assets_owned(JSON.stringify(owned))) as Asset[]
  return { btcSats, assets }
}

/** Create a fresh wallet: generate keys (JS), encrypt the seed under `password`,
 *  init the RGB stock (wasm), persist the vault + descriptor, and unlock it. */
export async function createWallet(password: string): Promise<GeneratedWallet> {
  const w = generateWallet()
  const vault = await encryptSeed(w.mnemonic, password)
  await openStock() // ensures a stock exists + persisted
  await kvPutAll({ descriptor: w.descriptor, vault })
  unlockedMnemonic = w.mnemonic
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

/** Build a witness-vout RGB receive invoice for `amount` of `contractId`. */
export async function createInvoice(contractId: string, amount: number, network = 'signet'): Promise<string> {
  const descriptor = await getDescriptor()
  if (!descriptor) throw new Error('no wallet — set one up first')
  const s = await openStock()
  return s.create_invoice(descriptor, contractId, BigInt(amount), network)
}

/** A keychain-0 BTC address — the wallet's funding address for a swap (the maker
 *  scans it for the taker's BTC inputs). keychain-0 is the BTC payment leg;
 *  keychain-10 is for RGB. This is THE BTC deposit address. */
export async function fundingAddress(network = 'signet'): Promise<string | undefined> {
  const descriptor = await getDescriptor()
  if (!descriptor) return undefined
  await rgbReady()
  const addrs = JSON.parse(wasm.derive_addresses(descriptor, network, 0, 1)) as string[]
  return addrs[0]
}

/** Spendable BTC at the funding address (keychain-0). This is the balance a swap
 *  can actually use — so it matches what the maker scans, unlike a wallet-wide
 *  sum that would include keychain-10 RGB-anchor dust. */
export async function btcFundingSats(network = 'signet'): Promise<number> {
  const addr = await fundingAddress(network)
  if (!addr) return 0
  const utxos = await addressUtxos(addr).catch(() => [] as Utxo[])
  return utxos.reduce((sum, u) => sum + (u.value || 0), 0)
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim().replace(/\s+/g, ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

/** The taker's SELL leg: build an RGB consignment paying the maker's `invoice`,
 *  returned as base64 (the dApp POSTs it to the broker; the maker validates it and
 *  re-anchors the RGB into the swap tx). `create_transfer` needs a hydrated UTXO
 *  set — wasm has no synced wallet — so we Esplora-scan the wallet's own UTXOs
 *  (keychains 0/1/10), each tagged with its (keychain, index) derivation. The PSBT
 *  it builds is discarded; read-only against the stock, so nothing to persist. */
export async function createTransfer(
  invoice: string,
  fee: number,
  network = 'signet',
): Promise<string> {
  const descriptor = await getDescriptor()
  if (!descriptor) throw new Error('no wallet — set one up first')
  const s = await openStock()
  const tagged = await ownedAddresses(network)
  const lists = await Promise.all(
    tagged.map((t) =>
      addressUtxos(t.address)
        .then((us) =>
          us.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, keychain: t.keychain, index: t.index })),
        )
        .catch(() => [] as Array<{ txid: string; vout: number; value: number; keychain: number; index: number }>),
    ),
  )
  const utxos = lists.flat()
  if (utxos.length === 0) throw new Error('no spendable UTXOs to build the transfer')
  const bytes = s.create_transfer(descriptor, invoice, JSON.stringify(utxos), BigInt(fee), network)
  return bytesToB64(bytes)
}

// The wallet's derived addresses across the keychains RGB swaps touch, each
// tagged with its (keychain, index) so the decoder can tell the signer exactly
// which input to sign with which key.
async function ownedAddresses(
  network = 'signet',
): Promise<Array<{ address: string; keychain: number; index: number }>> {
  const descriptor = await getDescriptor()
  if (!descriptor) return []
  await rgbReady()
  const tagged: Array<{ address: string; keychain: number; index: number }> = []
  for (const keychain of [0, 1, 10]) {
    const addrs = JSON.parse(wasm.derive_addresses(descriptor, network, keychain, 20)) as string[]
    addrs.forEach((address, index) => tagged.push({ address, keychain, index }))
  }
  return tagged
}

/** Decode a maker's partial PSBT into the wallet's BTC side (which inputs/outputs
 *  are ours, net delta, fee). The security core of a sign request. */
export async function decodePsbt(psbtB64: string, network = 'signet'): Promise<DecodedPsbt> {
  await openStock()
  const [owned, addrs] = await Promise.all([ownedOutpoints(network), ownedAddresses(network)])
  const bytes = b64ToBytes(psbtB64)
  return JSON.parse(wasm.decode_psbt(bytes, JSON.stringify(owned), JSON.stringify(addrs))) as DecodedPsbt
}

/** The witness txids a consignment commits to (parsed in wasm — no accept, no
 *  chain access). The import queue keys + watches an item by these. */
export async function consignmentWitnessIds(consignmentB64: string): Promise<string[]> {
  const s = await openStock()
  return JSON.parse(s.consignment_witness_ids(b64ToBytes(consignmentB64))) as string[]
}

/** Accept a consignment into the stock with caller-supplied witness ords, then
 *  persist. Idempotent: re-accepting an already-accepted consignment with fresh
 *  (now-mined) ords promotes the allocation's WitnessOrd Tentative→Mined — the
 *  queue's promote path, since the wasm exposes no separate `update_witnesses`. */
export async function acceptConsignmentOrds(
  consignmentB64: string,
  ords: Array<{ txid: string; height?: number; time?: number }>,
  network = 'signet',
): Promise<void> {
  const s = await openStock()
  s.accept_consignment(b64ToBytes(consignmentB64), JSON.stringify(ords), network)
  await persist()
}

/** Re-derive contract state from fresh witness ords WITHOUT re-accepting a
 *  consignment — the queue's promote/revert primitive. OVERLAY semantics: only the
 *  listed witnesses change; every other known witness keeps its current ord, so
 *  touching one asset never disturbs the rest. `{ txid, height?, time? }` → Mined
 *  (promote), `{ txid, archived: true }` → Archived (revert, allocation dropped). */
export async function updateWitnesses(
  ords: Array<{ txid: string; height?: number; time?: number; archived?: boolean }>,
  network = 'signet',
): Promise<void> {
  const s = await openStock()
  s.update_witnesses(JSON.stringify(ords), network)
  await persist()
}

/** Every witness txid the stock knows — for a wallet-wide witness sync (fetch each
 *  one's chain status, feed back via `updateWitnesses`). */
export async function stockWitnessIds(): Promise<string[]> {
  const s = await openStock()
  return JSON.parse(s.stock_witness_ids()) as string[]
}

/** Import (accept) an RGB asset from a base64 consignment in one shot. Parses the
 *  witness txids, fetches their chain status via Esplora, then accepts + persists.
 *  The import queue (`import-queue.ts`) is the robust, restart-surviving path; this
 *  remains for direct/synchronous use. */
export async function importAsset(consignmentB64: string, network = 'signet'): Promise<void> {
  const txids = await consignmentWitnessIds(consignmentB64)
  const ords = await witnessOrds(txids)
  await acceptConsignmentOrds(consignmentB64, ords, network)
}

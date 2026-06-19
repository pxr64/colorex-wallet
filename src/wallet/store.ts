// The wallet store: owns the wasm RGB `Stock`, persists it to IndexedDB, and is
// the single source of truth for the UI's dynamic asset list. Keys/seed vault is
// a later milestone — for now we persist the RGB stock blobs + the (non-secret)
// descriptor so the wallet can list assets and derive addresses across reopens.

import { rgbReady, wasm } from './rgb'
import { accountXprvFromMnemonic, generateWallet, type GeneratedWallet } from './keys'
import { decryptSeed, encryptSeed, isLegacyVault, type Vault } from './vault'
import { addressUtxos, witnessOrds, type Utxo } from './esplora'
import type { DecodedPsbt } from '../colorex/sign-request'

export interface Asset {
  contractId: string
  ticker: string
  precision: number
  balance: number
  /** Distinct owned outpoints holding this asset (from the wasm). */
  utxos: number
}

// Re-exported from the pure `units` module so existing importers (worker, UI) keep
// `import { formatUnits } from '../wallet/store'` while test-pure modules import it directly.
export { formatUnits } from './units'

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

async function kvDelete(keys: string[]): Promise<void> {
  const conn = await db()
  return new Promise((resolve, reject) => {
    const tx = conn.transaction(STORE_NAME, 'readwrite')
    const os = tx.objectStore(STORE_NAME)
    for (const k of keys) os.delete(k)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// --- descriptor encryption at rest (#1) ---
// Sensitive blobs are encrypted at rest under a key HKDF'd from the unlocked
// account XPRV, which lives ONLY in the hot session (memory) — so the on-disk blob
// is opaque to anyone with just disk/IndexedDB access. Two such blobs:
//   • the bp-std DESCRIPTOR (embeds the account XPUB → derive every address the
//     wallet ever uses; plaintext = a linkable history/privacy leak), and
//   • the RGB STOCK (stash/state/index → which assets, amounts, contracts, history).
// This is privacy-at-rest, not a key secret: both are derivable from / bound to the
// XPRV anyway, so keying their at-rest encryption to the XPRV loses nothing. The
// trade-off: anything reading them (balances, address derivation, the import-queue
// drain) needs an unlocked session — see `canAccessStock` (was: worked while locked).

interface EncBlob {
  salt: Uint8Array
  iv: Uint8Array
  ct: Uint8Array
}

// HKDF `info` domain-separators — distinct keys per blob class from the same XPRV.
const DESCRIPTOR_INFO = 'colorex-descriptor-v1'
const STOCK_INFO = 'colorex-stock-v1'

const enc = (s: string): Uint8Array => new TextEncoder().encode(s)
const bsrc = (u: Uint8Array): BufferSource => u as unknown as BufferSource

// HKDF-SHA256 from the high-entropy account XPRV — no slow KDF needed (the input
// is already secret + high-entropy; HKDF just shapes it into an AES key). `info`
// domain-separates the descriptor key from the stock key.
async function blobKey(xprv: string, salt: Uint8Array, info: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', bsrc(enc(xprv)), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: bsrc(salt), info: bsrc(enc(info)) },
    ikm,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function sealBytes(data: Uint8Array, xprv: string, info: string): Promise<EncBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await blobKey(xprv, salt, info)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bsrc(iv) }, key, bsrc(data)))
  return { salt, iv, ct }
}

async function openBytes(blob: EncBlob, xprv: string, info: string): Promise<Uint8Array> {
  const key = await blobKey(xprv, blob.salt, info)
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bsrc(blob.iv) }, key, bsrc(blob.ct)))
}

async function encryptDescriptor(descriptor: string, xprv: string): Promise<EncBlob> {
  return sealBytes(enc(descriptor), xprv, DESCRIPTOR_INFO)
}

async function decryptDescriptor(blob: EncBlob, xprv: string): Promise<string> {
  const pt = await openBytes(blob, xprv, DESCRIPTOR_INFO)
  return new TextDecoder().decode(pt)
}

// --- unlock rate-limiting (#1) ---
// Brute-forcing a stolen device is throttled by escalating lockouts that PERSIST
// across popup closes (chrome.storage.local — survives the ephemeral worker too).
// The first LOCK_FREE_TRIES wrong guesses are free (fat-finger tolerance); after
// that each failure imposes a growing cooldown. Combined with the Argon2id KDF
// (each guess already costs ~19 MiB + real time), this makes online brute force
// against the popup impractical without UX pain for a legitimate typo.
interface UnlockGuard {
  fails: number
  lockedUntil: number
}
const GUARD_KEY = 'unlockGuard'
const LOCK_FREE_TRIES = 5
// Cooldown applied on the Nth failure once past the free tries (clamped to last).
const LOCKOUT_STEPS_MS = [30_000, 60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000]
// Optional destructive backstop: wipe the vault after this many consecutive fails.
// DISABLED by default (0) — the encrypted vault IS the user's funds, and an
// auto-wipe is a griefing/DoS footgun + risks loss if their recovery phrase backup
// is imperfect. The Argon2id KDF + lockouts already make brute force impractical.
// Set > 0 only with an explicit, well-understood recovery story.
const WIPE_AFTER_FAILS = 0

async function readGuard(): Promise<UnlockGuard> {
  try {
    const { [GUARD_KEY]: g } = await chrome.storage.local.get(GUARD_KEY)
    return (g as UnlockGuard | undefined) ?? { fails: 0, lockedUntil: 0 }
  } catch {
    return { fails: 0, lockedUntil: 0 }
  }
}

async function writeGuard(g: UnlockGuard): Promise<void> {
  try {
    await chrome.storage.local.set({ [GUARD_KEY]: g })
  } catch {
    /* storage unavailable — fail open (no lockout) rather than brick unlock */
  }
}

async function clearGuard(): Promise<void> {
  try {
    await chrome.storage.local.remove(GUARD_KEY)
  } catch {
    /* ignore */
  }
}

function lockoutFor(fails: number): number {
  const i = Math.min(fails - LOCK_FREE_TRIES, LOCKOUT_STEPS_MS.length - 1)
  return i < 0 ? 0 : LOCKOUT_STEPS_MS[i]
}

type Stock = InstanceType<typeof wasm.RgbStock>
let stock: Stock | null = null

// The unlocked ACCOUNT XPRV (BIP-86 `m/86'/1'/0'`) — held in memory while
// unlocked and mirrored into chrome.storage.session (memory-only, cleared on
// browser/extension shutdown — never written to disk) so the session survives
// popup close/reopen without a re-unlock. Sliding AUTO_LOCK_MS expiry + idle/OS-
// lock auto-lock (driven from the worker).
//
// SECURITY (#2): the RAW MNEMONIC is NEVER cached here — it stays only in the
// encrypted vault (the recovery copy). A leak of the hot session therefore exposes
// THIS account's signing key (can drain this wallet) but not the portable,
// cross-wallet recovery phrase. The mnemonic materializes only transiently, in the
// context where the password was typed, during unlock/create — then is dropped.
let unlockedXprv: string | null = null

const SESSION_KEY = 'unlocked'
const AUTO_LOCK_MS = 15 * 60 * 1000 // 15 minutes (sliding; idle auto-lock backstop)

interface SessionEntry {
  xprv: string
  expiresAt: number
}

async function persistSession(xprv: string): Promise<void> {
  try {
    const entry: SessionEntry = { xprv, expiresAt: Date.now() + AUTO_LOCK_MS }
    await chrome.storage.session.set({ [SESSION_KEY]: entry })
  } catch {
    /* session storage unavailable — fall back to in-memory only */
  }
}

/** Restore an unlocked session persisted across popup opens / worker restarts.
 *  Returns true if a valid, non-expired session was found (and refreshes its
 *  sliding expiry). Loads only the derived account xprv — never the mnemonic. */
export async function restoreSession(): Promise<boolean> {
  if (unlockedXprv) return true
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
  unlockedXprv = entry.xprv
  await openStock()
  await persistSession(entry.xprv) // sliding window on each restore
  return true
}

/** Whether an (encrypted) wallet already exists on this device. */
export async function walletExists(): Promise<boolean> {
  return (await kvGet<Vault>('vault')) !== undefined
}

export function isUnlocked(): boolean {
  return unlockedXprv !== null
}

/** Clear the in-memory key, the decrypted stock, AND the persisted session
 *  (explicit Lock, idle timeout, or OS screen-lock). Dropping `stock` means a
 *  locked wallet holds no decrypted RGB state in memory; openStock re-loads +
 *  re-decrypts it on the next unlock. */
export function lock(): void {
  unlockedXprv = null
  stock = null
  void chrome.storage.session.remove(SESSION_KEY)
}

/** Whether the encrypted stock can be read/written right now — i.e. the wallet is
 *  unlocked, or a still-valid session is restorable into this (possibly fresh MV3)
 *  worker. The headless import-queue drain checks this to DEFER cleanly while
 *  locked instead of erroring every item (the consignment stays durably queued and
 *  imports on the next unlock — nothing is stranded). */
export async function canAccessStock(): Promise<boolean> {
  return (await signingKey()) !== null
}

/** The unlocked BIP-86 account xprv for worker-confined signing. Restores from
 *  the hot session if this context hasn't loaded it yet (e.g. a freshly-respawned
 *  MV3 worker). Null while locked. The mnemonic is never returned — signing uses
 *  the derived account key only. */
export async function signingKey(): Promise<string | null> {
  if (unlockedXprv) return unlockedXprv
  await restoreSession()
  return unlockedXprv
}

/** The outcome of an unlock attempt. `wrong` carries how many free tries remain
 *  before lockouts begin; `locked` carries the remaining cooldown so the UI can
 *  count down. `wiped` only occurs if WIPE_AFTER_FAILS is enabled. */
export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'no-wallet' }
  | { ok: false; reason: 'wrong'; triesLeft: number }
  | { ok: false; reason: 'locked'; retryInMs: number }
  | { ok: false; reason: 'wiped' }

/** Decrypt the vault with `password`, derive + cache the account xprv. Wrong
 *  passwords are rate-limited (escalating lockouts that persist across popup
 *  closes). On success, opportunistically upgrades a legacy PBKDF2 vault to
 *  Argon2id and a plaintext descriptor to its encrypted-at-rest form. The
 *  decrypted mnemonic is used only to derive the account key, then dropped — it is
 *  never persisted to the hot session. */
export async function unlock(password: string): Promise<UnlockResult> {
  const vault = await kvGet<Vault>('vault')
  if (!vault) return { ok: false, reason: 'no-wallet' }

  const guard = await readGuard()
  if (guard.lockedUntil > Date.now()) {
    return { ok: false, reason: 'locked', retryInMs: guard.lockedUntil - Date.now() }
  }

  let mnemonic: string
  try {
    mnemonic = await decryptSeed(vault, password)
  } catch {
    // Wrong password (AES-GCM auth failure) — bump the guard.
    const fails = guard.fails + 1
    if (WIPE_AFTER_FAILS > 0 && fails >= WIPE_AFTER_FAILS) {
      await wipeWallet()
      return { ok: false, reason: 'wiped' }
    }
    const lockedUntil = fails >= LOCK_FREE_TRIES ? Date.now() + lockoutFor(fails) : 0
    await writeGuard({ fails, lockedUntil })
    if (lockedUntil > Date.now()) return { ok: false, reason: 'locked', retryInMs: lockedUntil - Date.now() }
    return { ok: false, reason: 'wrong', triesLeft: Math.max(0, LOCK_FREE_TRIES - fails) }
  }

  // Correct password — reset the guard, unlock, and upgrade stored formats.
  await clearGuard()
  unlockedXprv = accountXprvFromMnemonic(mnemonic)
  const upgrades: Record<string, unknown> = {}
  if (isLegacyVault(vault)) upgrades.vault = await encryptSeed(mnemonic, password)
  const rawDesc = await kvGet<string | EncBlob>('descriptor')
  if (typeof rawDesc === 'string') upgrades.descriptor = await encryptDescriptor(rawDesc, unlockedXprv)
  if (Object.keys(upgrades).length) await kvPutAll(upgrades)
  await openStock()
  await persistSession(unlockedXprv)
  return { ok: true }
}

/** Destructive: erase all wallet state (vault, descriptor, RGB stock) and clear
 *  the session + guard. Used only by the optional wipe-after-N-failures backstop
 *  (disabled by default). Recovery is via the BIP-39 phrase only. */
async function wipeWallet(): Promise<void> {
  unlockedXprv = null
  stock = null
  await kvDelete(['vault', 'descriptor', 'stash', 'state', 'index'])
  await clearGuard()
  try {
    await chrome.storage.session.remove(SESSION_KEY)
  } catch {
    /* ignore */
  }
}

/** Decrypt one stored stock blob. Legacy plaintext (a bare Uint8Array from before
 *  at-rest encryption) is returned as-is; an EncBlob needs the unlocked XPRV. */
async function openStockBytes(raw: Uint8Array | EncBlob): Promise<Uint8Array> {
  if (raw instanceof Uint8Array) return raw // legacy plaintext (migrates on next persist)
  if (!unlockedXprv) throw new Error('RGB stock is encrypted — unlock required')
  return openBytes(raw, unlockedXprv, STOCK_INFO)
}

/** Load the RGB stock from IndexedDB (or create a fresh one) — idempotent. The
 *  stash/state/index blobs are encrypted at rest (#1), so loading an existing
 *  stock requires an unlocked session; throws otherwise (callers that may run
 *  locked — balances, the drain — guard with `canAccessStock`). */
export async function openStock(): Promise<Stock> {
  if (stock) return stock
  await rgbReady()
  const [stash, state, index] = await Promise.all([
    kvGet<Uint8Array | EncBlob>('stash'),
    kvGet<Uint8Array | EncBlob>('state'),
    kvGet<Uint8Array | EncBlob>('index'),
  ])
  if (stash != null && state != null && index != null) {
    const [a, b, c] = await Promise.all([openStockBytes(stash), openStockBytes(state), openStockBytes(index)])
    stock = wasm.RgbStock.load(a, b, c)
    // Upgrade a legacy plaintext stock to encrypted-at-rest now that we're unlocked.
    if (stash instanceof Uint8Array && unlockedXprv) await persist()
  } else {
    stock = new wasm.RgbStock()
    await persist()
  }
  return stock
}

/** Write the RGB stock through to IndexedDB, encrypted at rest. Call after every
 *  mutation. Requires an unlocked session (the stock is sealed under the XPRV key);
 *  throws while locked rather than silently writing plaintext. */
export async function persist(): Promise<void> {
  if (!stock) return
  if (!unlockedXprv) throw new Error('cannot persist RGB stock while locked')
  const snap = stock.save()
  const [stash, state, index] = await Promise.all([
    sealBytes(snap.stash, unlockedXprv, STOCK_INFO),
    sealBytes(snap.state, unlockedXprv, STOCK_INFO),
    sealBytes(snap.index, unlockedXprv, STOCK_INFO),
  ])
  await kvPutAll({ stash, state, index })
}

// The wallet's own outpoints (`txid:vout`), by scanning its derived addresses on
// Esplora — used to filter RGB allocations down to what we actually hold.
async function ownedOutpoints(network = 'signet'): Promise<string[]> {
  const descriptor = await getDescriptor()
  if (!descriptor) return []
  await rgbReady()
  const addrs: string[] = []
  for (const keychain of [0, 1, 10]) {
    // FLAT first-20-per-keychain scan — every index 0..19 is queried regardless
    // of emptiness (no gap-limit truncation), so sparse low indices are fine.
    // SAFE TODAY because receive addresses derive from a fresh in-memory wallet
    // with no persisted used-index state, so they land at ~index 0 — well inside
    // this window. If that ever changes (persistent derivation state, or fresh
    // per-invoice receive addresses for privacy), keychain-10 indices can climb
    // past 20 and we'd silently miss our own RGB — the same class of bug that
    // stranded the maker's tapret change (rgb-rfq: bp-wallet's gap-limited scan +
    // index drift). Fix then would be a RESETTING gap limit (extend the window
    // while activity is found), not a flat cap. Our RGB outputs are plain P2TR
    // (we never host the tapret commitment — the maker does), so this is purely
    // an address-window concern, not a tweaked-spk one.
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

/** One asset balance: spendable (confirmed/mined) + total (incl. mempool /
 *  tentative). `total - spendable` is the pending delta. `utxos` = distinct
 *  owned outpoints holding the asset. */
export interface AssetBalances {
  contractId: string
  ticker: string
  precision: number
  spendable: number
  total: number
  utxos: number
}

export interface AccountBalances {
  btc: { spendableSats: number; totalSats: number; utxos: number }
  assets: AssetBalances[]
}

/** THE canonical balance computation — one address derivation + one Esplora scan
 *  — the single source of truth for BOTH the wallet popup AND the dApp provider,
 *  so they can never drift. The wallet owns the RGB stash, so it is necessarily
 *  authoritative; the dApp only renders what `getBalances()` returns.
 *
 *  - BTC = the single ACTIVE account (keychain-0, index 0 — the address a swap
 *    funds from). `spendable` = confirmed, `total` = confirmed + mempool.
 *  - RGB = stock allocations ∩ ALL owned outpoints (an allocation can sit on any
 *    keychain). `spendable == total` until per-allocation tentative tracking
 *    lands (colorex-wallet#4).
 *
 *  Derivation path: m/86'/1'/0'/<0;1;10>/* (BIP-86 taproot; 0=receive, 1=change,
 *  10=tapret anchors). A future account feature switches the index. */
export async function accountBalances(network = 'signet'): Promise<AccountBalances> {
  const s = await openStock()
  const empty: AccountBalances = { btc: { spendableSats: 0, totalSats: 0, utxos: 0 }, assets: [] }
  const descriptor = await getDescriptor()
  if (!descriptor) return empty
  await rgbReady()

  const tagged = await ownedAddresses(network)
  if (tagged.length === 0) {
    // No derivable addresses → unfiltered stock balances (can't owned-filter BTC).
    const assets = (JSON.parse(s.list_assets()) as Asset[]).map((a) => ({
      contractId: a.contractId,
      ticker: a.ticker,
      precision: a.precision,
      spendable: a.balance,
      total: a.balance,
      utxos: a.utxos,
    }))
    return { ...empty, assets }
  }
  // Single Esplora scan across the derived addresses.
  const lists = await Promise.all(tagged.map((t) => addressUtxos(t.address).catch(() => [] as Utxo[])))

  // BTC: the active account (keychain-0, index 0). Stranded dust on other indices
  // is excluded for now (account-switcher is the future fix).
  const fIdx = tagged.findIndex((t) => t.keychain === 0 && t.index === 0)
  const fundingUtxos = fIdx >= 0 ? lists[fIdx] : []
  let spendableSats = 0
  let totalSats = 0
  for (const u of fundingUtxos) {
    const v = u.value || 0
    totalSats += v
    if (u.confirmed) spendableSats += v
  }

  // RGB: an allocation is tentative exactly when its anchoring outpoint is still
  // in the mempool. Query the stock twice — ALL owned outpoints (total) vs
  // CONFIRMED-only (spendable) — so `total - spendable` is the pending (incoming)
  // amount from an in-flight swap. `utxos` (distinct outpoints) comes from the
  // total set.
  const flat = lists.flat()
  const ownedAll = flat.map((u) => `${u.txid}:${u.vout}`)
  const ownedConfirmed = flat.filter((u) => u.confirmed).map((u) => `${u.txid}:${u.vout}`)
  const totalAssets = JSON.parse(s.list_assets_owned(JSON.stringify(ownedAll))) as Asset[]
  const spendableById = new Map(
    (JSON.parse(s.list_assets_owned(JSON.stringify(ownedConfirmed))) as Asset[]).map((a) => [
      a.contractId,
      a.balance,
    ]),
  )
  const assets = totalAssets.map((a) => ({
    contractId: a.contractId,
    ticker: a.ticker,
    precision: a.precision,
    spendable: spendableById.get(a.contractId) ?? 0,
    total: a.balance,
    utxos: a.utxos,
  }))
  return { btc: { spendableSats, totalSats, utxos: fundingUtxos.length }, assets }
}

/** Home-popup shape, derived from the canonical [`accountBalances`]. */
export async function walletSnapshot(network = 'signet'): Promise<WalletSnapshot> {
  const b = await accountBalances(network)
  return {
    btcSats: b.btc.totalSats,
    assets: b.assets.map((a) => ({
      contractId: a.contractId,
      ticker: a.ticker,
      precision: a.precision,
      balance: a.total,
      utxos: a.utxos,
    })),
  }
}

/** Create a fresh wallet: generate keys (JS), encrypt the seed under `password`,
 *  init the RGB stock (wasm), persist the vault + descriptor, and unlock it. */
export async function createWallet(password: string): Promise<GeneratedWallet> {
  const w = generateWallet()
  const vault = await encryptSeed(w.mnemonic, password)
  // Cache the derived account xprv (not the mnemonic) FIRST — openStock/persist
  // seal the stock under it, so it must be set before the stock is written. The
  // caller still gets the mnemonic back to display once for backup; it isn't
  // persisted to session.
  unlockedXprv = accountXprvFromMnemonic(w.mnemonic)
  await openStock() // ensures a stock exists + is persisted (encrypted)
  // Descriptor is encrypted at rest under an xprv-derived key (#1).
  const descriptor = await encryptDescriptor(w.descriptor, unlockedXprv)
  await kvPutAll({ descriptor, vault })
  await clearGuard()
  await persistSession(unlockedXprv)
  return w
}

/** The bp-std descriptor, decrypted. Requires an unlocked session (the at-rest
 *  blob is encrypted under an xprv-derived key) — returns undefined while locked,
 *  so balance/address derivation is gated behind unlock. A not-yet-migrated
 *  plaintext descriptor (legacy) is returned as-is. */
export async function getDescriptor(): Promise<string | undefined> {
  const raw = await kvGet<string | EncBlob>('descriptor')
  if (raw == null) return undefined
  if (typeof raw === 'string') return raw // legacy plaintext (migrates on next unlock)
  const xprv = await signingKey()
  if (!xprv) return undefined
  try {
    return await decryptDescriptor(raw, xprv)
  } catch {
    return undefined
  }
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
/** BTC at the keychain-0 funding address, split into confirmed (spendable) and
 *  total (confirmed + mempool). `total - spendable` is the pending delta. */
export async function btcFundingSats(
  network = 'signet',
): Promise<{ spendableSats: number; totalSats: number }> {
  const addr = await fundingAddress(network)
  if (!addr) return { spendableSats: 0, totalSats: 0 }
  const utxos = await addressUtxos(addr).catch(() => [] as Utxo[])
  let spendableSats = 0
  let totalSats = 0
  for (const u of utxos) {
    const v = u.value || 0
    totalSats += v
    if (u.confirmed) spendableSats += v
  }
  return { spendableSats, totalSats }
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

export interface SellConsignment {
  /** base64 RGB provenance consignment */
  consignment: string
  /** the RGB UTXOs being sold (named to the maker on the wire) */
  outpoints: Array<{ txid: string; vout: number }>
}

/** The taker's SELL leg (provenance model): pick the wallet's own RGB UTXOs for
 *  `contractId` covering `amount`, export a provenance consignment for them, and
 *  return it (base64) + the chosen outpoints. The dApp POSTs both to the broker;
 *  the maker validates the consignment, confirms the RGB at those outpoints, and
 *  spends them into the swap tx it builds. Pure stock read — no PSBT, no fee, no
 *  wallet hydration. See rgb-rfq docs/provenance-consignment-proposal.md. */
export async function createTransfer(
  contractId: string,
  amount: number,
  network = 'signet',
): Promise<SellConsignment> {
  const s = await openStock()
  // Which of our owned UTXOs carry this contract's RGB, with amounts.
  const owned = await ownedOutpoints(network)
  const allocs = JSON.parse(
    s.contract_outpoints(contractId, JSON.stringify(owned)),
  ) as Array<{ outpoint: string; amount: number }>
  // Pick largest-first until we cover `amount`.
  allocs.sort((a, b) => b.amount - a.amount)
  const chosen: string[] = []
  let have = 0
  for (const a of allocs) {
    if (have >= amount) break
    have += a.amount
    chosen.push(a.outpoint)
  }
  if (have < amount) {
    throw new Error(`insufficient RGB to sell: have ${have}, need ${amount}`)
  }
  const bytes = s.create_transfer(contractId, JSON.stringify(chosen))
  const outpoints = chosen.map((o) => {
    const [txid, vout] = o.split(':')
    return { txid, vout: Number(vout) }
  })
  return { consignment: bytesToB64(bytes), outpoints }
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

/** The outpoints a (provenance) consignment names as its terminal allocations — the set the taker
 *  offered for sale. Validated into a FRESH scratch stock in wasm, so only THIS consignment's
 *  terminals surface (not the wallet's other holdings). The #38 sell input-set check requires the
 *  PSBT's spent RGB anchors to be a subset of these — else the maker spliced in our other UTXOs. */
export async function consignmentSaleOutpoints(consignmentB64: string, network: string): Promise<string[]> {
  const s = await openStock()
  return JSON.parse(s.consignment_sale_outpoints(b64ToBytes(consignmentB64), network)) as string[]
}

/** The RGB a maker consignment delivers to the wallet's OWN seals — the trustless
 *  RGB-side delta for the confirmation screen and the #38 delivered-value gate. Runs on
 *  a throwaway scratch stock (the live stash is never mutated, gap A2); RGB delivered to
 *  a seal we don't own contributes 0. `mySeals` = the outpoints we expect to receive on
 *  ("txid:vout"), sourced wallet-side from `decodePsbt` (our k10-tagged swap-tx output).
 *  Mining is enforced separately (the SPV gate); this is the structural delivered amount. */
export async function consignmentDeliveryToMe(
  consignmentB64: string,
  mySeals: string[],
  network = 'signet',
): Promise<{ contractId: string; ticker: string; precision: number; amount: number }> {
  const s = await openStock()
  return JSON.parse(
    s.consignment_delivery_to_me(b64ToBytes(consignmentB64), network, JSON.stringify(mySeals)),
  )
}

/** The RGB assets (+ balances) the wallet holds at exactly `outpoints` ("txid:vout").
 *  Wallet-derived from the stock — used to value the k10 anchors a sell spends (the RGB
 *  AT RISK), without trusting the dApp's claimed asset/amount. */
export async function rgbAtOutpoints(outpoints: string[]): Promise<Asset[]> {
  const s = await openStock()
  return JSON.parse(s.list_assets_owned(JSON.stringify(outpoints))) as Asset[]
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

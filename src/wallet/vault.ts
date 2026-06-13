// Encrypted seed vault — the real key-at-rest. The BIP-39 mnemonic is encrypted
// with a key derived from the user's password and stored in IndexedDB. Wrong
// password → AES-GCM auth failure → decrypt throws. The plaintext seed never
// persists; it lives in memory only while the wallet is unlocked (see store.ts).
//
// KDF (#1): the password → key step uses **Argon2id** (memory-hard, RFC 9106) so
// a stolen vault can't be brute-forced on GPUs/ASICs the way a compute-only KDF
// (PBKDF2-SHA256) can — each guess is forced to touch ~19 MiB of RAM, collapsing
// the attacker's parallelism advantage. Params are stored IN the vault (so they
// can be tuned/raised later) and bound into AES-GCM AAD (so a downgrade/tamper of
// the header fails authentication). Legacy vaults (no `v` field — PBKDF2-SHA256
// @250k) still DECRYPT here; store.ts re-wraps them as v2 on the next unlock.

import { argon2idAsync } from '@noble/hashes/argon2'

/** Argon2id cost params. OWASP's browser-friendly minimum (m=19 MiB, t=2, p=1).
 *  Stored per-vault so we can raise them without breaking old vaults. p=1 because
 *  JS is single-threaded — extra lanes buy nothing here. */
const ARGON2ID = { m: 19_456, t: 2, p: 1 } as const
const DK_LEN = 32 // AES-256 key

// Legacy PBKDF2 params — read-only, for decrypting pre-Argon2id vaults.
const PBKDF2_ITERS = 250_000

interface Argon2idParams {
  name: 'argon2id'
  m: number
  t: number
  p: number
}

/** Argon2id vault (current format). */
export interface VaultV2 {
  v: 2
  kdf: Argon2idParams
  salt: Uint8Array
  iv: Uint8Array
  ct: Uint8Array
}

/** Legacy PBKDF2-SHA256 @250k vault (no version tag). Decrypt-only. */
export interface LegacyVault {
  salt: Uint8Array
  iv: Uint8Array
  ct: Uint8Array
}

export type Vault = VaultV2 | LegacyVault

/** A legacy (pre-Argon2id) vault — no version tag. store.ts upgrades these on
 *  unlock by re-encrypting under Argon2id with the just-verified password.
 *  (Plain boolean, not a type predicate: VaultV2 is structurally a superset of
 *  LegacyVault, so a `v is LegacyVault` guard would collapse the negative branch.) */
export function isLegacyVault(v: Vault): boolean {
  return !('v' in v)
}

// WebCrypto wants `BufferSource`; recent TS types `Uint8Array<ArrayBufferLike>`
// which doesn't structurally match, so cast at the call boundary.
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource
const enc = (s: string): Uint8Array => new TextEncoder().encode(s)

/** Canonical AAD binding the vault header (version + KDF params) into the AES-GCM
 *  tag, so flipping the version or weakening the cost params can't pass auth. The
 *  exact same bytes must be reproduced at decrypt time. */
function aad(params: Argon2idParams): Uint8Array {
  return enc(`colorex-vault.v2.${params.name}.m=${params.m}.t=${params.t}.p=${params.p}`)
}

async function argon2idKey(password: string, salt: Uint8Array, p: Argon2idParams): Promise<CryptoKey> {
  // asyncTick yields to the event loop between passes so the popup stays painted
  // (the "Unlocking…" / "Generating…" state shows while this runs).
  const raw = await argon2idAsync(password, salt, { m: p.m, t: p.t, p: p.p, dkLen: DK_LEN, asyncTick: 20 })
  return crypto.subtle.importKey('raw', buf(raw), 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function pbkdf2Key(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', buf(enc(password)), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSeed(mnemonic: string, password: string): Promise<VaultV2> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const kdf: Argon2idParams = { name: 'argon2id', ...ARGON2ID }
  const key = await argon2idKey(password, salt, kdf)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: buf(iv), additionalData: buf(aad(kdf)) },
      key,
      buf(enc(mnemonic)),
    ),
  )
  return { v: 2, kdf, salt, iv, ct }
}

export async function decryptSeed(vault: Vault, password: string): Promise<string> {
  if (!('v' in vault)) {
    // Legacy: PBKDF2-SHA256 @250k, no AAD — the original format.
    const key = await pbkdf2Key(password, vault.salt)
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(vault.iv) }, key, buf(vault.ct))
    return new TextDecoder().decode(pt)
  }
  const key = await argon2idKey(password, vault.salt, vault.kdf)
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(vault.iv), additionalData: buf(aad(vault.kdf)) },
    key,
    buf(vault.ct),
  )
  return new TextDecoder().decode(pt)
}

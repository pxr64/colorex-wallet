// Encrypted seed vault — the real key-at-rest. The BIP-39 mnemonic is encrypted
// with a key derived from the user's password (WebCrypto PBKDF2-SHA256 →
// AES-GCM-256) and stored in IndexedDB. Wrong password → AES-GCM auth failure →
// decrypt throws. The plaintext seed never persists; it lives in memory only
// while the wallet is unlocked (see store.ts).

const PBKDF2_ITERS = 250_000

export interface Vault {
  salt: Uint8Array
  iv: Uint8Array
  ct: Uint8Array
}

// WebCrypto wants `BufferSource`; recent TS types `Uint8Array<ArrayBufferLike>`
// which doesn't structurally match, so cast at the call boundary.
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw',
    buf(new TextEncoder().encode(password)),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: buf(salt), iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptSeed(mnemonic: string, password: string): Promise<Vault> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv) }, key, buf(new TextEncoder().encode(mnemonic))),
  )
  return { salt, iv, ct }
}

export async function decryptSeed(vault: Vault, password: string): Promise<string> {
  const key = await deriveKey(password, vault.salt)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(vault.iv) }, key, buf(vault.ct))
  return new TextDecoder().decode(pt)
}

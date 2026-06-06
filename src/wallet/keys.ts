// Key generation in JS (pure-JS, audited) — bp-wallet's `hot` key store pulls
// aws-lc, which isn't wasm-able, so seed/xpub derivation lives here and only the
// descriptor is handed to wasm. BIP-86 taproot, testnet/signet (coin 1').

import { HDKey } from '@scure/bip32'
import { generateMnemonic, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'

// Testnet/signet extended-key version bytes (tprv/tpub).
const TESTNET_VERSIONS = { private: 0x04358394, public: 0x043587cf }

export interface GeneratedWallet {
  mnemonic: string
  /** bp-std XpubDerivable descriptor: `[fp/86h/1h/0h]tpub…/<0;1;10>/*` */
  descriptor: string
}

/** Generate a fresh 12-word BIP-39 wallet and its BIP-86 tapret descriptor
 *  (keychains 0=receive, 1=change, 10=tapret RGB anchors). */
export function generateWallet(): GeneratedWallet {
  const mnemonic = generateMnemonic(wordlist, 128) // 12 words
  return walletFromMnemonic(mnemonic)
}

export function walletFromMnemonic(mnemonic: string): GeneratedWallet {
  const seed = mnemonicToSeedSync(mnemonic)
  const master = HDKey.fromMasterSeed(seed, TESTNET_VERSIONS)
  const fp = (master.fingerprint >>> 0).toString(16).padStart(8, '0')
  const account = master.derive("m/86'/1'/0'")
  const tpub = account.publicExtendedKey
  const descriptor = `[${fp}/86h/1h/0h]${tpub}/<0;1;10>/*`
  return { mnemonic, descriptor }
}

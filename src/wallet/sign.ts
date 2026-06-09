// Taproot PSBT signing — in JS (the background WORKER, the single context that
// holds the unlocked key), since bp-wallet's signing path pulls aws-lc (not
// wasm-able). The wallet signs EXACTLY the inputs it was told to (signInputs),
// each with the BIP-86 key for its (keychain, addrIndex) — never auto-detecting.
// Derivation parity with the wasm address derivation is verified. Returns the
// partially-signed PSBT (the maker finalizes its own inputs + combines).
//
// Signs from the ACCOUNT-level xprv (`m/86'/1'/0'`), not the mnemonic — the
// worker-confined hot key (#2). The raw recovery phrase never reaches here.

import { HDKey } from '@scure/bip32'
import * as btc from '@scure/btc-signer'
import type { SignInput } from '../types/sign-request'

// tprv/tpub version bytes (testnet/signet), matching keys.ts — needed so
// `fromExtendedKey` parses a tprv account key.
const TESTNET_VERSIONS = { private: 0x04358394, public: 0x043587cf }

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

/** Sign the given inputs of a maker's partial PSBT with the wallet's keys.
 *  `signInputs` come from decode_psbt (index + keychain + addrIndex).
 *  `accountXprv` is the BIP-86 account key (`m/86'/1'/0'` tprv) from the unlocked
 *  worker session — see `accountXprvFromMnemonic`. */
export function signPsbt(psbtB64: string, signInputs: SignInput[], accountXprv: string): string {
  const account = HDKey.fromExtendedKey(accountXprv, TESTNET_VERSIONS)
  const tx = btc.Transaction.fromPSBT(b64ToBytes(psbtB64), {
    allowUnknownInputs: true,
    allowUnknownOutputs: true,
  })
  for (const si of signInputs) {
    const node = account.deriveChild(si.keychain).deriveChild(si.addrIndex)
    if (!node.privateKey || !node.publicKey) {
      throw new Error(`no key for ${si.keychain}/${si.addrIndex}`)
    }
    // The maker's PSBT omits our tap derivation, so tell the signer the key-path
    // internal key (x-only) before signing; signIdx then does the BIP-86 tweak +
    // key-path Schnorr sign. Finalize our input (the maker finalizes its own).
    tx.updateInput(si.index, { tapInternalKey: node.publicKey.slice(1) })
    // The maker marks the input SIGHASH_ALL (0x01); @scure defaults to allowing
    // only SIGHASH_DEFAULT (0x00) for taproot. Both are "sign everything" — permit
    // the one the maker set so signing matches its PSBT.
    tx.signIdx(node.privateKey, si.index, [btc.SigHash.DEFAULT, btc.SigHash.ALL])
    tx.finalizeIdx(si.index)
  }
  return bytesToB64(tx.toPSBT())
}

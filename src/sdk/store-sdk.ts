// The real WalletSdk, backed by the wasm-native wallet in src/wallet/store.ts
// (bp-wallet + rgb-api compiled to wasm). Replaces StubWalletSdk: the methods we
// actually built are wired; only create_invoice (blind/witnessReceive) and the
// taproot signPsbt are still pending wasm work.

import {
  btcFundingSats,
  createInvoice,
  fundingAddress,
  importAsset,
  listAssets as storeListAssets,
  openStock,
} from '../wallet/store'
import type { SignInput } from '../types/sign-request'
import type { AssetBalance, BitcoinNetworkName, ReceiveInvoice, WalletSdk } from './wallet-sdk'

const PENDING = (m: string): never => {
  throw new Error(`WalletSdk.${m} pending wasm (create_invoice / taproot signPsbt)`)
}

export class StoreWalletSdk implements WalletSdk {
  constructor(private readonly network: BitcoinNetworkName = 'signet') {}

  async initialize(): Promise<void> {
    await openStock()
  }
  getNetwork(): BitcoinNetworkName {
    return this.network
  }

  async getBtcBalance(): Promise<{ spendableSats: number; totalSats: number }> {
    // Balance at the keychain-0 funding address — what a swap can actually spend
    // (matches the address the maker scans). No confirmed/unconfirmed split yet.
    const sats = await btcFundingSats(this.network)
    return { spendableSats: sats, totalSats: sats }
  }

  async listAssets(): Promise<AssetBalance[]> {
    const assets = await storeListAssets()
    return assets.map((a) => ({
      assetId: a.contractId,
      ticker: a.ticker,
      precision: a.precision,
      spendable: a.balance,
      total: a.balance,
    }))
  }
  async getAssetBalance(assetId: string): Promise<AssetBalance> {
    const found = (await this.listAssets()).find((a) => a.assetId === assetId)
    if (!found) throw new Error(`asset not held: ${assetId}`)
    return found
  }

  async getAddress(): Promise<string> {
    const addr = await fundingAddress(this.network)
    if (!addr) throw new Error('no wallet — set one up first')
    return addr
  }

  // Blinded-seal receive needs a free anchor (coinselect over the UTXO set) — not
  // built; the wallet uses witness-vout receives instead.
  blindReceive(): Promise<ReceiveInvoice> {
    return PENDING('blindReceive')
  }
  async witnessReceive(params: { assetId?: string; amount?: number }): Promise<ReceiveInvoice> {
    if (!params.assetId || params.amount == null) {
      throw new Error('witnessReceive needs assetId + amount')
    }
    const invoice = await createInvoice(params.assetId, params.amount, this.network)
    return { invoice }
  }

  // Taproot signing is not yet in wasm — and must run where the seed is (the
  // approval popup), not the worker. signInputs tells it exactly what to sign.
  signPsbt(_psbtBase64: string, _signInputs: SignInput[]): Promise<string> {
    return PENDING('signPsbt')
  }

  // Real: accept (validate + absorb) the maker's consignment into the stash.
  async acceptConsignment(consignment: string): Promise<void> {
    await importAsset(consignment, this.network)
  }

  async refreshWallet(): Promise<void> {
    // The Esplora UTXO scan happens lazily inside listAssets/decodePsbt.
  }
}

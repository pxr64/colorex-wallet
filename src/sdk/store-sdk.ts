// The real WalletSdk, backed by the wasm-native wallet in src/wallet/store.ts
// (bp-wallet + rgb-api compiled to wasm). Replaces StubWalletSdk: the methods we
// actually built are wired; only create_invoice (blind/witnessReceive) and the
// taproot signPsbt are still pending wasm work.

import { fundingAddress, importAsset, listAssets as storeListAssets, openStock } from '../wallet/store'
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

  getBtcBalance(): Promise<{ spendableSats: number; totalSats: number }> {
    return PENDING('getBtcBalance')
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

  // create_invoice (witness/blind receive) is not yet in wasm.
  blindReceive(): Promise<ReceiveInvoice> {
    return PENDING('blindReceive')
  }
  witnessReceive(): Promise<ReceiveInvoice> {
    return PENDING('witnessReceive')
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

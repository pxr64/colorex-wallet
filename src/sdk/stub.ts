// Placeholder WalletSdk until the browser/WASM @utexo/rgb-sdk fork lands
// (ROADMAP M1). Every call throws so missing wiring fails loudly rather than
// silently faking wallet state. Replace with the real adapter; callers unchanged.

import type { AssetBalance, BitcoinNetworkName, ReceiveInvoice, WalletSdk } from './wallet-sdk'

const TODO = (m: string): never => {
  throw new Error(`WalletSdk.${m} not wired yet — pending browser @utexo/rgb-sdk (ROADMAP M1)`)
}

export class StubWalletSdk implements WalletSdk {
  constructor(private readonly network: BitcoinNetworkName = 'signet') {}

  initialize(): Promise<void> {
    return TODO('initialize')
  }
  getNetwork(): BitcoinNetworkName {
    return this.network
  }
  getBtcBalance(): Promise<{ spendableSats: number; totalSats: number }> {
    return TODO('getBtcBalance')
  }
  listAssets(): Promise<AssetBalance[]> {
    return TODO('listAssets')
  }
  getAssetBalance(): Promise<AssetBalance> {
    return TODO('getAssetBalance')
  }
  getAddress(): Promise<string> {
    return TODO('getAddress')
  }
  blindReceive(): Promise<ReceiveInvoice> {
    return TODO('blindReceive')
  }
  witnessReceive(): Promise<ReceiveInvoice> {
    return TODO('witnessReceive')
  }
  signPsbt(): Promise<string> {
    return TODO('signPsbt')
  }
  acceptConsignment(): Promise<void> {
    return TODO('acceptConsignment')
  }
  refreshWallet(): Promise<void> {
    return TODO('refreshWallet')
  }
}

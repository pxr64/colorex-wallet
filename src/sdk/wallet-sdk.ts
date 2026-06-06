// The subset of @utexo/rgb-sdk (`UTEXOWallet`) the extension depends on. We
// program against this interface so the rest of the app is independent of how
// the SDK is hosted (in-worker WASM — Target C — vs a fallback transport), and
// so signPsbt stays swappable for a hardware wallet later.
//
// Until the browser/WASM fork of @utexo/rgb-sdk lands (ROADMAP M1) this is
// backed by StubWalletSdk. Then drop in the real adapter, unchanged callers.

import type { AssetId } from '../colorex/types'
import type { SignInput } from '../types/sign-request'

export interface AssetBalance {
  assetId: string
  ticker: string
  precision: number
  spendable: number
  total: number
}

export interface ReceiveInvoice {
  invoice: string // RGB invoice string (blind or witness)
  expiresAtMs?: number
}

export interface WalletSdk {
  // --- lifecycle / keys ---
  initialize(): Promise<void>
  getNetwork(): BitcoinNetworkName

  // --- read path ---
  getBtcBalance(): Promise<{ spendableSats: number; totalSats: number }>
  listAssets(): Promise<AssetBalance[]>
  getAssetBalance(assetId: string): Promise<AssetBalance>

  // --- receive ---
  getAddress(): Promise<string> // BTC
  blindReceive(params: { assetId?: string; amount?: number }): Promise<ReceiveInvoice>
  witnessReceive(params: { assetId?: string; amount?: number }): Promise<ReceiveInvoice>

  // --- the three swap touchpoints (see docs/swap-flow.md) ---
  // 1. created via blind/witnessReceive above (taker's RGB receive invoice)
  // 2. sign the maker-built PSBT — signing EXACTLY the inputs the wallet was told
  //    to (with their derivations), never auto-detecting from the PSBT:
  signPsbt(psbtBase64: string, signInputs: SignInput[]): Promise<string>
  // 3. absorb the maker's consignment into the on-device stash:
  acceptConsignment(consignment: string): Promise<void>

  // --- sync ---
  refreshWallet(): Promise<void>
}

export type BitcoinNetworkName = 'signet' | 'testnet' | 'mainnet' | 'regtest'

// Maps the wallet's network to the AssetId.network the broker expects.
export function toBrokerNetwork(n: BitcoinNetworkName): AssetId['network'] {
  return ({ signet: 'Signet', testnet: 'Testnet', mainnet: 'Mainnet', regtest: 'Regtest' } as const)[n]
}

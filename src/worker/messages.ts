// Message protocol across the three contexts: dApp page ↔ content script ↔
// background worker ↔ approval popup. Every cross-context call carries an id so
// responses can be correlated and promises resolved.

import type { SignRequest, SignResult } from '../types/sign-request'

/** dApp-supplied sign request. The dApp hands the wallet a partial PSBT; the wallet is a
 *  wallet-agnostic SIGNER — it DECODES the PSBT and the consignment itself to compute what the
 *  user actually signs, trusting nothing dApp-claimed. Only plain-tx inputs are carried: the
 *  PSBT, the RGB asset id (a display LABEL only — the amount is wallet-derived), and the
 *  consignment (for pre-sign RGB verification). Swap-orchestration fields (amount, quoteId,
 *  makerId) are deliberately NOT consumed — the wallet doesn't need them. */
export interface SignAndSendIntent {
  psbt: string // maker's partial PSBT (base64), built by the dApp via the broker
  assetId?: string // RGB asset hint — display label only
  consignment?: string // the maker's RGB consignment, for the pre-sign verification
  expected_witness_txid?: string // swap-txid hint (advisory) — the wallet derives the exempt witness from the PSBT
}

/** page → worker (relayed by the content script). The queue kinds
 *  (`getImportQueue`/`enqueueConsignment`/`dismissImportItem`/`drainImportQueue`)
 *  are also used by the popup, which sends them directly via chrome.runtime. */
export type ProviderRequest =
  | { id: string; kind: 'connect'; origin: string }
  | { id: string; kind: 'getAccounts' }
  | { id: string; kind: 'getBalances' }
  | { id: string; kind: 'createInvoice'; contractId: string; amount: number }
  | { id: string; kind: 'buildConsignment'; contractId: string; amount: number }
  | { id: string; kind: 'acceptConsignment'; consignment: string; contractId?: string; amount?: number }
  | { id: string; kind: 'signAndSend'; intent: SignAndSendIntent; origin: string }
  | { id: string; kind: 'signPsbt'; psbtBase64: string }
  | { id: string; kind: 'getImportQueue' }
  | { id: string; kind: 'enqueueConsignment'; consignment: string }
  | { id: string; kind: 'dismissImportItem'; itemId: string }
  | { id: string; kind: 'drainImportQueue' }

/** BTC + RGB balances the dApp reads to render inventory. Amounts are base units
 *  (sats for BTC; the asset's base units at `precision` for RGB). */
export interface ProviderBalances {
  btc: { spendableSats: number; totalSats: number; utxos: number }
  assets: {
    contractId: string
    ticker: string
    precision: number
    spendable: number
    total: number
    utxos: number
  }[]
}

/** worker → page (relayed back) */
export type ProviderResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

/** popup ↔ worker */
export type PopupRequest =
  | { kind: 'getSignRequest'; id: string }
  | { kind: 'decide'; id: string; approve: boolean }
  | { kind: 'getConnectRequest'; id: string }
  | { kind: 'decideConnect'; id: string; approve: boolean }

export type PopupResponse =
  | { kind: 'signRequest'; request: SignRequest }
  | { kind: 'connectRequest'; request: ConnectRequest }
  | { kind: 'notFound' }
  | { kind: 'decided'; result: SignResult }
  | { kind: 'connectDecided'; approved: boolean }

/** A dApp connection request awaiting user approval in the popup. */
export interface ConnectRequest {
  id: string
  origin: string
}

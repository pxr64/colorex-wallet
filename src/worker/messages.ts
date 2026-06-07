// Message protocol across the three contexts: dApp page ↔ content script ↔
// background worker ↔ approval popup. Every cross-context call carries an id so
// responses can be correlated and promises resolved.

import type { SignRequest, SignResult } from '../types/sign-request'

/** dApp-supplied sign request. The dApp orchestrates the swap (broker round-trip)
 *  and hands the wallet the maker's PSBT; the wallet is a wallet-agnostic SIGNER —
 *  it independently DECODES the PSBT to compute what the user actually signs and
 *  never trusts the dApp's amounts for the BTC side. `assetId`/`amount` are RGB
 *  display hints, validated only on consignment-accept. */
export interface SignAndSendIntent {
  psbt: string // maker's partial PSBT (base64), built by the dApp via the broker
  assetId?: string
  amount?: number
  side?: 'buy' | 'sell'
  quoteId?: string
  makerId?: string
  consignment?: string
}

/** page → worker (relayed by the content script). The queue kinds
 *  (`getImportQueue`/`enqueueConsignment`/`dismissImportItem`/`drainImportQueue`)
 *  are also used by the popup, which sends them directly via chrome.runtime. */
export type ProviderRequest =
  | { id: string; kind: 'connect'; origin: string }
  | { id: string; kind: 'getAccounts' }
  | { id: string; kind: 'getBalances' }
  | { id: string; kind: 'createInvoice'; contractId: string; amount: number }
  | { id: string; kind: 'buildConsignment'; invoice: string }
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
  btc: { spendableSats: number; totalSats: number }
  assets: { contractId: string; ticker: string; precision: number; spendable: number; total: number }[]
}

/** worker → page (relayed back) */
export type ProviderResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

/** popup ↔ worker */
export type PopupRequest =
  | { kind: 'getSignRequest'; id: string }
  | { kind: 'decide'; id: string; approve: boolean; signedPsbt?: string }
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

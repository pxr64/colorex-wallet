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

/** page → worker (relayed by the content script) */
export type ProviderRequest =
  | { id: string; kind: 'connect'; origin: string }
  | { id: string; kind: 'getAccounts' }
  | { id: string; kind: 'signAndSend'; intent: SignAndSendIntent }
  | { id: string; kind: 'signPsbt'; psbtBase64: string }

/** worker → page (relayed back) */
export type ProviderResponse =
  | { id: string; ok: true; result: unknown }
  | { id: string; ok: false; error: string }

/** popup ↔ worker */
export type PopupRequest =
  | { kind: 'getSignRequest'; id: string }
  | { kind: 'decide'; id: string; approve: boolean }

export type PopupResponse =
  | { kind: 'signRequest'; request: SignRequest }
  | { kind: 'notFound' }
  | { kind: 'decided'; result: SignResult }

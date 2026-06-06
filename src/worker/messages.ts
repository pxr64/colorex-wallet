// Message protocol across the three contexts: dApp page ↔ content script ↔
// background worker ↔ approval popup. Every cross-context call carries an id so
// responses can be correlated and promises resolved.

import type { SignRequest, SignResult } from '../types/sign-request'

/** dApp-supplied INTENT. NEVER trusted for display — the worker independently
 *  builds + decodes the PSBT to compute what the user actually signs. */
export interface SignAndSendIntent {
  invoice?: string
  assetId?: string
  amount?: number
  side?: 'buy' | 'sell'
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

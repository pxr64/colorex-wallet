// MV3 background service worker — the wallet's brain. It:
//   • hosts the wallet SDK (Target C: in-worker WASM @utexo/rgb-sdk) + the Colorex client,
//   • keeps the pending sign-request registry (must outlive the popup),
//   • turns a dApp intent into a verified SignRequest by building + DECODING the
//     maker's PSBT (the security core — never trust dApp amounts),
//   • opens the approval window and, on approval, signs locally and finalizes.
//
// This is the M5–M7 skeleton: the broker round-trip + PSBT decode + finalize are
// marked TODO. The request registry, window opener, and message routing are real.

import { ColorexClient } from '../colorex/client'
import { StubWalletSdk } from '../sdk/stub'
import type { WalletSdk } from '../sdk/wallet-sdk'
import type { SignRequest, SignResult } from '../types/sign-request'
import type { PopupRequest, PopupResponse, ProviderRequest, SignAndSendIntent } from './messages'

const BROKER_URL = 'https://broker.colorex.exchange' // TODO: per-network config (M3)

// Swap StubWalletSdk for the real in-worker WASM adapter once it lands (M1).
const sdk: WalletSdk = new StubWalletSdk('signet')
const broker = new ColorexClient(BROKER_URL)

interface Pending {
  request: SignRequest
  settle: (result: SignResult) => void
}
const pending = new Map<string, Pending>()

// --- provider requests from the content script ---
chrome.runtime.onMessage.addListener((msg: ProviderRequest | PopupRequest, _sender, sendResponse) => {
  if ('kind' in msg && (msg.kind === 'getSignRequest' || msg.kind === 'decide')) {
    handlePopup(msg, sendResponse)
    return true
  }
  handleProvider(msg as ProviderRequest, sendResponse)
  return true // async sendResponse
})

async function handleProvider(msg: ProviderRequest, sendResponse: (r: unknown) => void) {
  try {
    switch (msg.kind) {
      case 'connect':
        await markConnected(msg.origin)
        return sendResponse({ id: msg.id, ok: true, result: { connected: true } })
      case 'getAccounts':
        return sendResponse({ id: msg.id, ok: true, result: await accounts() })
      case 'signAndSend': {
        const result = await signAndSend(msg.id, msg.intent)
        return sendResponse({ id: msg.id, ok: result.ok, result, error: result.ok ? undefined : result.error })
      }
      case 'signPsbt':
        return sendResponse({ id: msg.id, ok: true, result: await sdk.signPsbt(msg.psbtBase64) })
    }
  } catch (e) {
    sendResponse({ id: msg.id, ok: false, error: (e as Error).message })
  }
}

function handlePopup(msg: PopupRequest, sendResponse: (r: PopupResponse) => void) {
  if (msg.kind === 'getSignRequest') {
    const p = pending.get(msg.id)
    return sendResponse(p ? { kind: 'signRequest', request: p.request } : { kind: 'notFound' })
  }
  // decide
  void finalize(msg.id, msg.approve).then((result) => sendResponse({ kind: 'decided', result }))
}

// Build the verified SignRequest, open the approval window, and resolve when the
// user decides. The promise the dApp awaits is settled via `pending`.
async function signAndSend(id: string, intent: SignAndSendIntent): Promise<SignResult> {
  const request = await buildSignRequest(id, intent)
  return new Promise<SignResult>((resolve) => {
    pending.set(id, { request, settle: resolve })
    void openApprovalWindow(id)
  })
}

// TODO (M6 — security core): drive the broker (requestQuotes → acceptQuote),
// take the maker's partial PSBT, and DECODE it (+ RGB metadata) into deltas.
// Until then this throws so nothing renders fabricated amounts.
async function buildSignRequest(_id: string, _intent: SignAndSendIntent): Promise<SignRequest> {
  void broker
  throw new Error('buildSignRequest: broker round-trip + PSBT decode not implemented (ROADMAP M6)')
}

// TODO (M7): on approve → sdk.signPsbt → broker.submitSignedPsbt → accept
// consignment → resolve; on reject → user_rejected.
async function finalize(id: string, approve: boolean): Promise<SignResult> {
  const p = pending.get(id)
  if (!p) return { ok: false, error: 'sign_failed', message: 'unknown request' }
  pending.delete(id)
  const result: SignResult = approve
    ? { ok: false, error: 'sign_failed', message: 'finalize not implemented (ROADMAP M7)' }
    : { ok: false, error: 'user_rejected' }
  p.settle(result)
  return result
}

async function openApprovalWindow(id: string): Promise<void> {
  await chrome.windows.create({
    url: chrome.runtime.getURL(`index.html?id=${encodeURIComponent(id)}`),
    type: 'popup',
    width: 400,
    height: 640,
  })
}

// --- connected-origin allow-list (drives the trust pill / recognized branch) ---
async function markConnected(origin: string): Promise<void> {
  const { connected = [] } = await chrome.storage.local.get('connected')
  if (!connected.includes(origin)) {
    await chrome.storage.local.set({ connected: [...connected, origin] })
  }
}

async function accounts(): Promise<string[]> {
  // TODO (M3/M4): return the wallet's address(es) once keys + read path exist.
  return []
}

// MV3 background service worker — the wallet's brain. It:
//   • hosts the wallet SDK (Target C: in-worker WASM @utexo/rgb-sdk) + the Colorex client,
//   • keeps the pending sign-request registry (must outlive the popup),
//   • turns a dApp intent into a verified SignRequest by building + DECODING the
//     maker's PSBT (the security core — never trust dApp amounts),
//   • opens the approval window and, on approval, signs locally and finalizes.
//
// This is the M5–M7 skeleton: the broker round-trip + PSBT decode + finalize are
// marked TODO. The request registry, window opener, and message routing are real.

import { assembleSignRequest } from '../colorex/sign-request'
import { StoreWalletSdk } from '../sdk/store-sdk'
import type { WalletSdk } from '../sdk/wallet-sdk'
import { decodePsbt } from '../wallet/store'
import type { SignInput, SignRequest, SignResult } from '../types/sign-request'
import type { PopupRequest, PopupResponse, ProviderRequest, SignAndSendIntent } from './messages'

// The wallet is a wallet-agnostic SIGNER. It does NOT talk to the Colorex broker —
// the dApp orchestrates the swap (RFQ → accept) and hands us the maker's PSBT; we
// decode it (trustless) + sign. Backed by the wasm-native wallet (store) — only
// create_invoice + taproot signPsbt are still pending.
const sdk: WalletSdk = new StoreWalletSdk('signet')

interface Pending {
  request: SignRequest
  signInputs: SignInput[] // which inputs to sign + their derivations
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
      case 'signPsbt': {
        // Direct sign: decode first to learn which inputs are ours + their
        // derivations (the dApp can't be trusted to specify them).
        const decoded = await decodePsbt(msg.psbtBase64, sdk.getNetwork())
        return sendResponse({ id: msg.id, ok: true, result: await sdk.signPsbt(msg.psbtBase64, decoded.signInputs) })
      }
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
  const { request, signInputs } = await buildSignRequest(id, intent)
  return new Promise<SignResult>((resolve) => {
    pending.set(id, { request, signInputs, settle: resolve })
    void openApprovalWindow(id)
  })
}

// The security core: quote the buy, have the maker build the PSBT, then DECODE it
// (BTC side, wallet-derived) + take the RGB amount from the quote → a SignRequest
// with nothing trusted from the dApp. The RGB receive invoice + BTC funding address
// come from the wallet SDK (the in-wasm adapter, currently stubbed); the decode is
// real (rgb-wasm decode_psbt, verified against a live maker PSBT).
async function buildSignRequest(
  id: string,
  intent: SignAndSendIntent,
): Promise<{ request: SignRequest; signInputs: SignInput[] }> {
  if (!intent.psbt) {
    throw new Error('signAndSend requires the maker PSBT (the dApp builds it via the broker)')
  }
  const network = sdk.getNetwork()

  // DECODE the dApp-provided PSBT (trustless BTC side) + assemble. The wallet
  // never talks to the broker — the dApp orchestrated the swap and gave us the
  // PSBT. assetId/amount are RGB display hints, validated on consignment-accept.
  const decoded = await decodePsbt(intent.psbt, network)
  let assetTicker = intent.assetId?.slice(0, 10) ?? 'RGB'
  let assetPrecision = 0
  if (intent.assetId) {
    try {
      const bal = await sdk.getAssetBalance(intent.assetId)
      assetTicker = bal.ticker
      assetPrecision = bal.precision
    } catch {
      /* unknown asset — fall back to the contract id prefix */
    }
  }
  const { connected = [] } = await chrome.storage.local.get('connected')
  const request = assembleSignRequest({
    id,
    origin: 'app.colorex.exchange',
    recognized: connected.includes('app.colorex.exchange'),
    network,
    decoded,
    psbtBase64: intent.psbt,
    quoteId: intent.quoteId,
    makerId: intent.makerId,
    contractId: intent.assetId ?? '',
    assetTicker,
    assetPrecision,
    rgbAmountRaw: intent.amount ?? 0,
    side: intent.side ?? 'buy',
  })
  return { request, signInputs: decoded.signInputs }
}

// On approve → sign our PSBT inputs and return the signed PSBT. The dApp submits
// it to the broker (the maker finalizes + broadcasts), then hands us the final
// consignment via acceptConsignment. On reject → user_rejected.
async function finalize(id: string, approve: boolean): Promise<SignResult> {
  const p = pending.get(id)
  if (!p) return { ok: false, error: 'sign_failed', message: 'unknown request' }
  pending.delete(id)
  if (!approve) {
    const rejected: SignResult = { ok: false, error: 'user_rejected' }
    p.settle(rejected)
    return rejected
  }
  let result: SignResult
  try {
    const signedPsbt = await sdk.signPsbt(p.request.psbtBase64, p.signInputs)
    result = { ok: true, signedPsbt }
  } catch (e) {
    result = { ok: false, error: 'sign_failed', message: (e as Error).message }
  }
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

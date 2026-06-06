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
import { assembleSignRequest } from '../colorex/sign-request'
import { StubWalletSdk } from '../sdk/stub'
import { type WalletSdk, toBrokerNetwork } from '../sdk/wallet-sdk'
import { decodePsbt } from '../wallet/store'
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

// The security core: quote the buy, have the maker build the PSBT, then DECODE it
// (BTC side, wallet-derived) + take the RGB amount from the quote → a SignRequest
// with nothing trusted from the dApp. The RGB receive invoice + BTC funding address
// come from the wallet SDK (the in-wasm adapter, currently stubbed); the decode is
// real (rgb-wasm decode_psbt, verified against a live maker PSBT).
async function buildSignRequest(id: string, intent: SignAndSendIntent): Promise<SignRequest> {
  if (!intent.assetId || !intent.amount) {
    throw new Error('signAndSend intent requires assetId + amount')
  }
  const network = sdk.getNetwork()
  const brokerNet = toBrokerNetwork(network)

  // 1. Quote the buy.
  const quotes = await broker.requestQuotes({
    base_asset: { network: brokerNet, kind: 'Rgb20', id: intent.assetId },
    quote_asset: { network: brokerNet, kind: 'Btc', id: 'btc' },
    side: 'Buy',
    amount: intent.amount,
  })
  const quote = quotes[0]
  if (!quote) throw new Error('no maker quoted this RFQ')

  // 2. Accept → the maker builds the partial PSBT (needs our RGB invoice + funding).
  const { invoice: rgbInvoice } = await sdk.witnessReceive({ assetId: intent.assetId, amount: intent.amount })
  const fundingAddr = await sdk.getAddress()
  const settle = await broker.acceptQuote(quote.quote_id, {
    quote_id: quote.quote_id,
    leg: { side: 'buy', rgb_invoice: rgbInvoice, btc_funding_addr: fundingAddr },
  })
  const psbt = settle.transfer?.partial_psbt
  if (!psbt) throw new Error('accept returned no partial PSBT')

  // 3. DECODE (verify the BTC side) + assemble.
  const decoded = await decodePsbt(psbt, network)
  let assetTicker = intent.assetId.slice(0, 10)
  let assetPrecision = 0
  try {
    const bal = await sdk.getAssetBalance(intent.assetId)
    assetTicker = bal.ticker
    assetPrecision = bal.precision
  } catch {
    /* unknown asset — fall back to the contract id prefix */
  }
  const { connected = [] } = await chrome.storage.local.get('connected')
  return assembleSignRequest({
    id,
    origin: 'app.colorex.exchange',
    recognized: connected.includes('app.colorex.exchange'),
    network,
    decoded,
    psbtBase64: psbt,
    quoteId: quote.quote_id,
    makerId: quote.maker_id,
    contractId: quote.base_asset.id,
    assetTicker,
    assetPrecision,
    rgbAmountRaw: quote.amount,
    side: 'buy',
  })
}

// On approve → sign our PSBT inputs, submit to the broker (maker finalizes +
// broadcasts), absorb the returned consignment. On reject → user_rejected.
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
    const signed = await sdk.signPsbt(p.request.psbtBase64)
    const settled = await broker.submitSignedPsbt(p.request.quoteId ?? '', signed)
    if (settled.final_consignment) await sdk.acceptConsignment(settled.final_consignment)
    result = settled.witness_txid
      ? { ok: true, txid: settled.witness_txid, consignment: settled.final_consignment }
      : { ok: false, error: 'broadcast_failed', message: 'no witness txid' }
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

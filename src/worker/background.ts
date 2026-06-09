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
import { createInvoice, createTransfer, decodePsbt } from '../wallet/store'
import { drain, enqueue, getQueue, removeItem } from '../wallet/import-queue'
import type { SignRequest, SignResult } from '../types/sign-request'
import type {
  ConnectRequest,
  PopupRequest,
  PopupResponse,
  ProviderBalances,
  ProviderRequest,
  SignAndSendIntent,
} from './messages'

// The wallet is a wallet-agnostic SIGNER. It does NOT talk to the Colorex broker —
// the dApp orchestrates the swap (RFQ → accept) and hands us the maker's PSBT; we
// decode it (trustless) + sign. Backed by the wasm-native wallet (store) — only
// create_invoice + taproot signPsbt are still pending.
const sdk: WalletSdk = new StoreWalletSdk('signet')

// Fee for the taker's throwaway sell-consignment witness tx — mirrors taker-cli's
// SELL_RGB_FEE_SATS. The PSBT is discarded (the maker re-anchors), so this only
// has to be coverable by the RGB seal UTXO's bitcoin value (≥546 from the buy).
const SELL_RGB_FEE_SATS = 200

interface Pending {
  request: SignRequest
  settle: (result: SignResult) => void
}
const pending = new Map<string, Pending>()

interface PendingConnect {
  request: ConnectRequest
  settle: (approved: boolean) => void
}
const pendingConnect = new Map<string, PendingConnect>()
// Maps an approval window id → connect request id, so closing the window without
// deciding settles the dApp's connect() promise as a rejection (not a hang).
const connectWindows = new Map<number, string>()

chrome.windows.onRemoved.addListener((windowId) => {
  const id = connectWindows.get(windowId)
  if (id == null) return
  connectWindows.delete(windowId)
  const p = pendingConnect.get(id)
  if (p) {
    pendingConnect.delete(id)
    p.settle(false)
  }
})

const POPUP_KINDS = new Set(['getSignRequest', 'decide', 'getConnectRequest', 'decideConnect'])

// --- import-queue drain scheduling (MV3) ---
// The worker is ephemeral, so the drain loop is woken by chrome.alarms (survives
// the worker dying — setInterval would not), plus onStartup and a kick on load.
// The popup also pokes the worker (drainImportQueue) when it opens. Each wake-up
// processes the persisted queue: accept pending consignments, promote mined ones,
// flag dropped ones.
const DRAIN_ALARM = 'import-queue-drain'

async function ensureDrainAlarm(): Promise<void> {
  if (!(await chrome.alarms.get(DRAIN_ALARM))) {
    await chrome.alarms.create(DRAIN_ALARM, { periodInMinutes: 1 })
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === DRAIN_ALARM) void drain()
})
chrome.runtime.onStartup.addListener(() => {
  void ensureDrainAlarm()
  void drain()
})
chrome.runtime.onInstalled.addListener(() => void ensureDrainAlarm())
// Kick once on every worker spin-up (covers the wake that revived the worker).
void ensureDrainAlarm()
void drain()

// --- provider requests from the content script ---
chrome.runtime.onMessage.addListener((msg: ProviderRequest | PopupRequest, _sender, sendResponse) => {
  if ('kind' in msg && POPUP_KINDS.has(msg.kind)) {
    handlePopup(msg as PopupRequest, sendResponse)
    return true
  }
  handleProvider(msg as ProviderRequest, sendResponse)
  return true // async sendResponse
})

async function handleProvider(msg: ProviderRequest, sendResponse: (r: unknown) => void) {
  try {
    switch (msg.kind) {
      case 'connect': {
        // Ask the user to approve the connection (opens the approval popup).
        const approved = await requestConnect(msg.id, msg.origin)
        if (approved) await markConnected(msg.origin)
        return sendResponse({ id: msg.id, ok: true, result: { connected: approved } })
      }
      case 'getAccounts':
        return sendResponse({ id: msg.id, ok: true, result: await accounts() })
      case 'getBalances':
        return sendResponse({ id: msg.id, ok: true, result: await balances() })
      case 'createInvoice': {
        // Taker's RGB receive invoice (witness-vout). Built from the public
        // descriptor + stock — no seed needed.
        const invoice = await createInvoice(msg.contractId, msg.amount, sdk.getNetwork())
        return sendResponse({ id: msg.id, ok: true, result: invoice })
      }
      case 'buildConsignment': {
        // Sell leg: the taker builds an RGB consignment paying the maker's invoice.
        // rgb-wasm `create_transfer` scans the wallet's own UTXOs (in `createTransfer`)
        // to fund the throwaway witness tx; the maker re-anchors the RGB into the
        // swap tx. 200 sats mirrors taker-cli's SELL_RGB_FEE_SATS (the PSBT is
        // discarded, so this fee only has to be coverable by the RGB seal UTXO).
        const consignment = await createTransfer(msg.invoice, SELL_RGB_FEE_SATS, sdk.getNetwork())
        return sendResponse({ id: msg.id, ok: true, result: consignment })
      }
      case 'acceptConsignment': {
        // Buy leg, after broadcast: ENQUEUE the maker's consignment (persistent,
        // restart-surviving) rather than a one-shot import — the drain loop accepts
        // it + watches the witness tx (mined → spendable, dropped → reverted). Non-
        // blocking: we return once it's safely queued; the drain runs in background.
        await enqueue({
          consignment: msg.consignment,
          network: sdk.getNetwork(),
          source: 'swap',
          meta: { contractId: msg.contractId, amountRaw: msg.amount },
        })
        void drain()
        return sendResponse({ id: msg.id, ok: true, result: null })
      }
      case 'getImportQueue':
        return sendResponse({ id: msg.id, ok: true, result: await getQueue() })
      case 'enqueueConsignment': {
        // Manual paste path (from the popup). Same persistent queue as a swap.
        const item = await enqueue({ consignment: msg.consignment, network: sdk.getNetwork(), source: 'manual' })
        void drain()
        return sendResponse({ id: msg.id, ok: true, result: item })
      }
      case 'dismissImportItem':
        await removeItem(msg.itemId)
        return sendResponse({ id: msg.id, ok: true, result: null })
      case 'drainImportQueue':
        await drain()
        return sendResponse({ id: msg.id, ok: true, result: await getQueue() })
      case 'signAndSend': {
        const result = await signAndSend(msg.id, msg.intent, msg.origin)
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
  switch (msg.kind) {
    case 'getSignRequest': {
      const p = pending.get(msg.id)
      return sendResponse(p ? { kind: 'signRequest', request: p.request } : { kind: 'notFound' })
    }
    case 'decide':
      void finalize(msg.id, msg.approve, msg.signedPsbt).then((result) => sendResponse({ kind: 'decided', result }))
      return
    case 'getConnectRequest': {
      const p = pendingConnect.get(msg.id)
      return sendResponse(p ? { kind: 'connectRequest', request: p.request } : { kind: 'notFound' })
    }
    case 'decideConnect': {
      const p = pendingConnect.get(msg.id)
      if (p) {
        pendingConnect.delete(msg.id)
        p.settle(msg.approve)
      }
      return sendResponse({ kind: 'connectDecided', approved: msg.approve })
    }
  }
}

// Open the connect-approval window and resolve when the user decides. The dApp's
// connect() promise is settled via `pendingConnect`.
function requestConnect(id: string, origin: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    pendingConnect.set(id, { request: { id, origin }, settle: resolve })
    void openApprovalWindow(id, 'connect').then((winId) => {
      if (winId != null) connectWindows.set(winId, id)
    })
  })
}

// Build the verified SignRequest, open the approval window, and resolve when the
// user decides. The promise the dApp awaits is settled via `pending`.
async function signAndSend(id: string, intent: SignAndSendIntent, origin: string): Promise<SignResult> {
  const request = await buildSignRequest(id, intent, origin)
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
async function buildSignRequest(id: string, intent: SignAndSendIntent, origin: string): Promise<SignRequest> {
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
  return assembleSignRequest({
    id,
    origin,
    recognized: connected.includes(origin),
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
}

// The approval window signs locally (it holds the unlocked seed) and hands back
// the signed PSBT; we resolve the dApp's promise with it (the dApp submits to the
// broker → the maker finalizes + broadcasts). On reject → user_rejected.
async function finalize(id: string, approve: boolean, signedPsbt?: string): Promise<SignResult> {
  const p = pending.get(id)
  if (!p) return { ok: false, error: 'sign_failed', message: 'unknown request' }
  pending.delete(id)
  const result: SignResult = !approve
    ? { ok: false, error: 'user_rejected' }
    : signedPsbt
      ? { ok: true, signedPsbt }
      : { ok: false, error: 'sign_failed', message: 'no signature from approval window' }
  p.settle(result)
  return result
}

async function openApprovalWindow(id: string, kind?: 'connect'): Promise<number | undefined> {
  const k = kind ? `&kind=${kind}` : ''
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`index.html?id=${encodeURIComponent(id)}${k}`),
    type: 'popup',
    width: 400,
    height: 640,
  })
  return win.id
}

// --- connected-origin allow-list (drives the trust pill / recognized branch) ---
async function markConnected(origin: string): Promise<void> {
  const { connected = [] } = await chrome.storage.local.get('connected')
  if (!connected.includes(origin)) {
    await chrome.storage.local.set({ connected: [...connected, origin] })
  }
}

async function accounts(): Promise<string[]> {
  // Derive the funding address from the persisted descriptor (public — no seed
  // needed in the worker). Empty if no wallet has been set up yet.
  try {
    return [await sdk.getAddress()]
  } catch {
    return []
  }
}

// BTC + RGB balances for the dApp's inventory. Each read is guarded so a partial
// SDK (e.g. a not-yet-synced wallet) yields zeros/empty rather than throwing.
async function balances(): Promise<ProviderBalances> {
  let btc = { spendableSats: 0, totalSats: 0 }
  try {
    btc = await sdk.getBtcBalance()
  } catch {
    /* no wallet / not synced */
  }
  let assets: ProviderBalances['assets'] = []
  try {
    assets = (await sdk.listAssets()).map((a) => ({
      contractId: a.assetId,
      ticker: a.ticker,
      precision: a.precision,
      spendable: a.spendable,
      total: a.total,
    }))
  } catch {
    /* no assets / not synced */
  }
  return { btc, assets }
}

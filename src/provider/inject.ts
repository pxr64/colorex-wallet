// Injected into the dApp page (page JS context). Exposes `window.colorex`.
// It can't reach the worker directly, so it postMessages to the content script,
// which relays to the background worker and posts the response back.

import type { ProviderBalances, SignAndSendIntent } from '../worker/messages'

interface ColorexProvider {
  connect(): Promise<{ connected: boolean }>
  getAccounts(): Promise<string[]>
  getBalances(): Promise<ProviderBalances>
  signPsbt(psbtBase64: string): Promise<string>
  signAndSend(intent: SignAndSendIntent): Promise<{ txid: string; consignment?: string }>
}

const TARGET = 'colorex:provider'
let seq = 0
const waiting = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

window.addEventListener('message', (ev) => {
  if (ev.source !== window || ev.data?.target !== `${TARGET}:response`) return
  const { id, ok, result, error } = ev.data
  const w = waiting.get(id)
  if (!w) return
  waiting.delete(id)
  if (ok) w.resolve(result)
  else w.reject(new Error(error))
})

function call(kind: string, extra: Record<string, unknown> = {}): Promise<unknown> {
  const id = `${Date.now()}-${seq++}`
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    window.postMessage({ target: TARGET, id, kind, ...extra }, window.location.origin)
  })
}

const provider: ColorexProvider = {
  connect: () => call('connect', { origin: window.location.origin }) as Promise<{ connected: boolean }>,
  getAccounts: () => call('getAccounts') as Promise<string[]>,
  getBalances: () => call('getBalances') as Promise<ProviderBalances>,
  signPsbt: (psbtBase64) => call('signPsbt', { psbtBase64 }) as Promise<string>,
  signAndSend: (intent) =>
    call('signAndSend', { intent }) as Promise<{ txid: string; consignment?: string }>,
}

;(window as unknown as { colorex: ColorexProvider }).colorex = provider

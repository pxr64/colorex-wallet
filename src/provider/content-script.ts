// Content script (isolated world). Injects the page provider and relays messages
// between the page and the background worker. The page and worker can't talk
// directly; everything hops through here.

// 1. Inject the provider into the page's JS context.
const s = document.createElement('script')
s.src = chrome.runtime.getURL('src/provider/inject.ts')
s.type = 'module'
s.onload = () => s.remove()
;(document.head || document.documentElement).appendChild(s)

const TARGET = 'colorex:provider'

// 2. page → worker → page
window.addEventListener('message', async (ev) => {
  if (ev.source !== window || ev.data?.target !== TARGET) return
  const { id, kind, ...rest } = ev.data
  try {
    const res = await chrome.runtime.sendMessage({ id, kind, ...rest })
    window.postMessage({ target: `${TARGET}:response`, ...res }, window.location.origin)
  } catch (e) {
    window.postMessage(
      { target: `${TARGET}:response`, id, ok: false, error: (e as Error).message },
      window.location.origin,
    )
  }
})

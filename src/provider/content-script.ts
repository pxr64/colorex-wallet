// Content script (isolated world). Relays messages between the page and the
// background worker — the page and worker can't talk directly. The provider
// itself (window.colorex) is set by inject.ts, which runs as a separate
// MAIN-world content script (see manifest.ts).

const TARGET = 'colorex:provider'

// page → worker → page
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

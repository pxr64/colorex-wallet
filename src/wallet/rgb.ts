// Lazy loader for the rgb-wasm module (the RGB engine + bp-wallet, compiled to
// wasm). `--target web` output: a default `init(url)` that instantiates the wasm,
// plus the named exports. The popup is an extension page (same-origin), so it can
// fetch its own bundled `.wasm` asset directly.

import init, * as wasm from '../../rgb-wasm/pkg/rgb_wasm.js'
import wasmUrl from '../../rgb-wasm/pkg/rgb_wasm_bg.wasm?url'

let ready: Promise<void> | null = null

/** Instantiate the wasm module once. Await before touching `wasm.*`. */
export function rgbReady(): Promise<void> {
  if (!ready) ready = init({ module_or_path: wasmUrl }).then(() => undefined)
  return ready
}

export { wasm }

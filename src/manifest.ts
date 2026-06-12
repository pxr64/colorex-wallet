import { defineManifest } from '@crxjs/vite-plugin'

// Single source of truth for the MV3 manifest. window.colorex is injected on the
// Colorex dApp AND on localhost / 127.0.0.1 so third-party devs can build dApps
// against the wallet locally — on any port (Chrome match patterns are port-
// agnostic, so http://localhost/* covers every dev server). Injection ≠ access:
// every origin must still pass the per-origin connect-approval popup before it
// can read balances or request a signature (same model as MetaMask).
export default defineManifest(() => {
  const origins = ['https://app.colorex.io/*', 'http://localhost/*', 'http://127.0.0.1/*']
  return {
    manifest_version: 3,
    name: 'Colorex Wallet',
    version: '0.0.0',
    description:
      'RGB wallet for the Colorex exchange — self-custodial; keys and RGB state never leave your device.',
    action: { default_popup: 'index.html' },
    // MV3 blocks WebAssembly by default; the RGB engine needs wasm-unsafe-eval.
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    background: { service_worker: 'src/worker/background.ts', type: 'module' },
    content_scripts: [
      // Runs in the page's MAIN world so it can set window.colorex. Declaring it
      // as a content script (not a hand-injected <script>) makes crxjs COMPILE it
      // to real JS — a raw .ts file loaded as a module would fail to parse.
      {
        matches: origins,
        js: ['src/provider/inject.ts'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      // Isolated world: relays messages between the page and the worker.
      {
        matches: origins,
        js: ['src/provider/content-script.ts'],
        run_at: 'document_start',
      },
    ],
    permissions: ['storage', 'alarms', 'idle'],
    host_permissions: origins,
  }
})

import { defineManifest } from '@crxjs/vite-plugin'

// Single source of truth for the MV3 manifest. Host/match patterns point at the
// Colorex dApp; tighten/extend as more origins connect.
export default defineManifest({
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
    {
      matches: ['https://app.colorex.exchange/*'],
      js: ['src/provider/content-script.ts'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    {
      resources: ['src/provider/inject.ts'],
      matches: ['https://app.colorex.exchange/*'],
    },
  ],
  permissions: ['storage'],
  host_permissions: ['https://app.colorex.exchange/*'],
})

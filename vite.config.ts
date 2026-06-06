import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { crx } from '@crxjs/vite-plugin'
import manifest from './src/manifest'

// MV3 build via @crxjs/vite-plugin: it wires the popup (index.html), the
// background service worker, and the content script declared in the manifest.
export default defineConfig({
  plugins: [react(), crx({ manifest })],
})

import { defineConfig } from 'vitest/config'

// Unit tests run in a plain Node env against the wallet's PURE logic (checkpoint
// reconcile, nearest-checkpoint, cache policy). The MV3 build (crx plugin, wasm,
// IndexedDB, service worker) is intentionally NOT loaded here — those integration
// pieces are exercised in the extension runtime, not unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

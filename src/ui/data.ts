// Display metadata for KNOWN tickers (glyph + kind) only. The actual asset list
// is dynamic — it comes from the wallet store (`listAssets()`, backed by the wasm
// RGB stock). Unknown tickers fall back to their initials + the RGB accent dot.

export interface AssetMeta {
  sym: string
  name: string
  kind: 'btc' | 'rgb'
  glyph: string
}

export const ASSETS: Record<string, AssetMeta> = {
  tBTC: { sym: 'tBTC', name: 'Bitcoin · signet', kind: 'btc', glyph: '₿' },
  BTC: { sym: 'BTC', name: 'Bitcoin', kind: 'btc', glyph: '₿' },
}

export const ACCOUNT = {
  name: 'Account 1',
  avatarHue: 24,
}

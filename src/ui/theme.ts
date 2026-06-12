// Design tokens + global styles, originally ported from the design handoff.
// The `T` object below is now the self-contained source of truth.

export const T = {
  bg: '#FAF8F3', // popup field
  panel: '#F3F0E9',
  ink: '#11110E',
  inkSoft: '#3C3A34',
  mute: '#827C71',
  faint: '#ABA59B',
  hair: '#E7E4DC',
  hairStrong: '#D2CEC4',
  card: '#FFFFFF',
  accent: '#B85A2C',
  accentInk: '#FFFFFF',
  accentSoft: 'rgba(184,90,44,0.07)',
  accentTint: '#F7EFE6',
  accentTintStrong: '#F0E2D3',
  accentDeep: '#9A4A23',
  ok: '#3DAE6B',
  okSoft: 'rgba(61,174,107,0.12)',
  warn: '#C98A2E',
  body: '"Geist", -apple-system, sans-serif',
  mono: '"Geist Mono", ui-monospace, monospace',
} as const

export const POPUP_W = 380
// Chrome caps extension popups at 600px tall; anything taller is clipped by the
// window (a pinned footer button becomes unreachable). Stay at the cap so the
// internal scroll areas handle overflow instead.
export const POPUP_H = 600

const PRICE_USD: Record<string, number> = {
  tBTC: 64180,
  RGBX: 2.567,
  'USDT-RGB': 1.0,
  'USDC-RGB': 1.0,
}

/** Display formatting, from the original design handoff. */
export function fmt(n: number, sym?: string): string {
  if (n == null || isNaN(n)) return '0'
  if (sym === 'tBTC')
    return Number(n).toLocaleString('en-US', {
      minimumFractionDigits: n < 1 ? 5 : 2,
      maximumFractionDigits: 8,
    })
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

export function usd(n: number): string {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function priceUsd(sym: string): number | undefined {
  return PRICE_USD[sym]
}

const CSS = `
.cxw *, .cxw *::before, .cxw *::after { box-sizing: border-box; }
.cxw { font-feature-settings: 'ss01','cv11','tnum'; -webkit-font-smoothing: antialiased; }
.cxw-tab { font-variant-numeric: tabular-nums; font-feature-settings: 'tnum'; }
.cxw-btn { transition: transform .12s, box-shadow .16s, background .16s, border-color .16s, opacity .15s, color .15s; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.cxw-btn:not(:disabled):hover { transform: translateY(-1px); }
.cxw-btn:not(:disabled):active { transform: translateY(0) scale(0.99); }
.cxw-btn:disabled { opacity: .42; cursor: not-allowed; }
.cxw-input { outline: none; -webkit-tap-highlight-color: transparent; }
.cxw-input::placeholder { color: ${T.faint}; }
.cxw-field { transition: border-color .16s, box-shadow .16s; }
.cxw-field:focus-within { border-color: ${T.accent} !important; box-shadow: 0 0 0 3px ${T.accent}22; }
@keyframes cxw-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
.cxw-pulse { animation: cxw-pulse 2s ease-in-out infinite; }
@keyframes cxw-in { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:none} }
.cxw-in { animation: cxw-in .4s cubic-bezier(.2,.7,.2,1) both; }
@keyframes cxw-slide { from{opacity:0;transform:translateX(16px)} to{opacity:1;transform:none} }
.cxw-slide { animation: cxw-slide .32s cubic-bezier(.2,.7,.2,1) both; }
@keyframes cxw-pop { 0%{transform:scale(.6);opacity:0} 60%{transform:scale(1.12)} 100%{transform:scale(1);opacity:1} }
.cxw-pop { animation: cxw-pop .5s cubic-bezier(.2,.8,.3,1) both; }
@keyframes cxw-spin { to{transform:rotate(360deg)} }
.cxw-spin { animation: cxw-spin .9s linear infinite; transform-origin: center; }
.cxw-scroll::-webkit-scrollbar { width: 7px; }
.cxw-scroll::-webkit-scrollbar-thumb { background: ${T.hairStrong}; border-radius: 4px; border: 2px solid transparent; background-clip: content-box; }
.cxw-scroll::-webkit-scrollbar-track { background: transparent; }
@media (prefers-reduced-motion: reduce) {
  .cxw-in, .cxw-slide, .cxw-pop, .cxw-pulse, .cxw-spin { animation: none !important; }
}
`

/** Inject the global stylesheet once. Call from the UI entry point. */
export function injectGlobalStyles(): void {
  if (typeof document === 'undefined' || document.getElementById('cxw-styles')) return
  const s = document.createElement('style')
  s.id = 'cxw-styles'
  s.textContent = CSS
  document.head.appendChild(s)
}

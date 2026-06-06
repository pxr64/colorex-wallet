// Shared UI atoms + icons, ported from the design handoff (wallet-core.jsx `I`,
// `Logo`, `AssetIcon`, `QR`, atoms; wallet-sign.jsx `SIG_I`; wallet-ui.jsx
// `AccountAvatar`). The `T` tokens are the source of truth in theme.ts.

import type { CSSProperties, ReactNode, SVGProps } from 'react'
import { T } from './theme'
import { ASSETS } from './data'

type P = SVGProps<SVGSVGElement>

export const Icon = {
  arrow: (p: P) => (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" {...p}><path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  back: (p: P) => (
    <svg viewBox="0 0 14 14" width="14" height="14" fill="none" {...p}><path d="M11 7H3m0 0 3.5 3.5M3 7l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  up: (p: P) => (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" {...p}><path d="M8 13V3m0 0L3.5 7.5M8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  down: (p: P) => (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" {...p}><path d="M8 3v10m0 0 4.5-4.5M8 13l-4.5-4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  swap: (p: P) => (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" {...p}><path d="M5 3v10m0 0L2.5 10.5M5 13l2.5-2.5M11 13V3m0 0L8.5 5.5M11 3l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  check: (p: P) => (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" {...p}><path d="M2.5 7.5 6 11l5.5-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  chev: (p: P) => (
    <svg viewBox="0 0 12 12" width="11" height="11" fill="none" {...p}><path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  copy: (p: P) => (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" {...p}><rect x="3" y="3" width="7" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.2" /><path d="M3 8.5H2.2A1.2 1.2 0 0 1 1 7.3V2.2A1.2 1.2 0 0 1 2.2 1h5.1A1.2 1.2 0 0 1 8.5 2.2V3" stroke="currentColor" strokeWidth="1.2" /></svg>
  ),
  lock: (p: P) => (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" {...p}><rect x="2.5" y="6" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.2" /><path d="M4.5 6V4.3a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.2" /></svg>
  ),
  eye: (p: P) => (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" {...p}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="1.8" stroke="currentColor" strokeWidth="1.2" /></svg>
  ),
  eyeOff: (p: P) => (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" {...p}><path d="M6.3 6.3a1.8 1.8 0 0 0 2.5 2.5M3 4.6C1.9 5.6 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.3 2.7-.7M12.4 10.6C13.8 9.6 14.5 8 14.5 8S12 3.5 8 3.5c-.5 0-1 .1-1.4.2M2 2l12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
  ),
  paste: (p: P) => (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" {...p}><rect x="3" y="2.5" width="8" height="9.5" rx="1.3" stroke="currentColor" strokeWidth="1.2" /><path d="M5.4 2.5V2a.8.8 0 0 1 .8-.8h1.6a.8.8 0 0 1 .8.8v.5" stroke="currentColor" strokeWidth="1.2" /><path d="M5 6.5h4M5 8.8h2.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" /></svg>
  ),
  shield: (p: P) => (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" {...p}><path d="M7 1.2 2.5 3v3.4C2.5 9.3 4.4 11.6 7 12.8c2.6-1.2 4.5-3.5 4.5-6.4V3z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
  ),
  ext: (p: P) => (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" {...p}><path d="M5 3H3.5A1.5 1.5 0 0 0 2 4.5v6A1.5 1.5 0 0 0 3.5 12h6A1.5 1.5 0 0 0 11 10.5V9M8 2h4m0 0v4m0-4L6.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
  ),
  bolt: (p: P) => (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" {...p}><path d="M7.5 1 3 8h3.2l-.7 5L11 6H7.5z" fill="currentColor" stroke="none" /></svg>
  ),
  x: (p: P) => (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" {...p}><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
  ),
  globe: (p: P) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" {...p}><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" /><path d="M2 8h12M8 2c1.8 1.6 1.8 10.4 0 12M8 2C6.2 3.6 6.2 12.4 8 14" stroke="currentColor" strokeWidth="1.2" /></svg>
  ),
  pen: (p: P) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" {...p}><path d="M10.8 2.6 13.4 5.2 5.6 13H3v-2.6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M9.4 4l2.6 2.6" stroke="currentColor" strokeWidth="1.2" /></svg>
  ),
  alert: (p: P) => (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" {...p}><path d="M8 2.5 14.5 13.5H1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /><path d="M8 6.5v3.2M8 11.4v.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
  ),
}

export function Mono({ children, style, className }: { children: ReactNode; style?: CSSProperties; className?: string }) {
  return (
    <span className={className} style={{ fontFamily: T.mono, ...style }}>
      {children}
    </span>
  )
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ fontFamily: T.mono, fontSize: 10, color: T.mute, letterSpacing: '0.09em', textTransform: 'uppercase', ...style }}>
      {children}
    </div>
  )
}

export function Tag({ children, tone = 'accent', small }: { children: ReactNode; tone?: 'accent' | 'rgb' | 'ok'; small?: boolean }) {
  const c =
    tone === 'rgb'
      ? { color: T.accent, bg: T.accentTint, bd: T.accentTintStrong }
      : tone === 'ok'
        ? { color: T.ok, bg: T.okSoft, bd: 'rgba(61,174,107,0.3)' }
        : { color: T.mute, bg: T.panel, bd: T.hair }
  return (
    <span style={{ fontFamily: T.mono, fontSize: small ? 8.5 : 9, letterSpacing: '0.07em', textTransform: 'uppercase', color: c.color, background: c.bg, border: `1px solid ${c.bd}`, padding: small ? '1px 5px' : '2px 6px', borderRadius: 999, whiteSpace: 'nowrap', lineHeight: 1.4 }}>
      {children}
    </span>
  )
}

export function Live({ label = 'live', color = T.ok }: { label?: string; color?: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: T.mono, fontSize: 9.5, color: T.mute, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      <span className="cxw-pulse" style={{ width: 5, height: 5, borderRadius: 999, background: color }} />
      {label}
    </span>
  )
}

export function AssetIcon({ sym, size = 36, isRgb }: { sym: string; size?: number; isRgb?: boolean }) {
  const meta = ASSETS[sym]
  const glyph = meta?.glyph ?? sym.slice(0, 2)
  const rgb = isRgb ?? (meta ? meta.kind === 'rgb' : true)
  const isBtc = !rgb
  return (
    <span style={{ width: size, height: size, flex: '0 0 auto', borderRadius: isBtc ? 999 : size * 0.26, border: `1px solid ${isBtc ? T.ink : T.hairStrong}`, background: isBtc ? T.ink : T.card, color: isBtc ? T.bg : T.ink, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.mono, fontWeight: 500, fontSize: glyph.length > 1 ? size * 0.3 : size * 0.46, position: 'relative', overflow: 'hidden' }}>
      {rgb && <span style={{ position: 'absolute', top: size * 0.13, right: size * 0.13, width: size * 0.085, height: size * 0.085, borderRadius: 999, background: T.accent }} />}
      {glyph}
    </span>
  )
}

export function AccountAvatar({ size = 26, hue = 24 }: { size?: number; hue?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 999, flex: '0 0 auto', background: `conic-gradient(from 200deg, oklch(0.7 0.12 ${hue}), oklch(0.55 0.14 ${hue + 40}), oklch(0.72 0.11 ${hue - 30}), oklch(0.7 0.12 ${hue}))`, border: `1px solid ${T.hairStrong}` }} />
  )
}

export function Logo({ size = 22 }: { size?: number }) {
  const r = size * 0.135
  const off = size * 0.27
  const c1 = off
  const c2 = size - off
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <line x1={c1} y1={c1} x2={c2} y2={c2} stroke={T.accent} strokeWidth={size * 0.045} opacity="0.32" />
      <line x1={c2} y1={c1} x2={c1} y2={c2} stroke={T.ink} strokeWidth={size * 0.045} opacity="0.16" />
      <circle cx={c1} cy={c1} r={r} fill={T.ink} />
      <circle cx={c2} cy={c1} r={r} fill={T.ink} />
      <circle cx={c1} cy={c2} r={r} fill={T.accent} />
      <circle cx={c2} cy={c2} r={r} fill={T.ink} />
    </svg>
  )
}

// Deterministic decorative QR (module grid from a seed) — ported from wallet-core.jsx.
export function QR({ seed = 'rgb', size = 132 }: { seed?: string; size?: number }) {
  const N = 21
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const rnd = () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return ((h >>> 0) % 1000) / 1000
  }
  const finders: [number, number][] = [[0, 0], [0, N - 7], [N - 7, 0]]
  const isFinder = (rr: number, cc: number) => finders.some(([fr, fc]) => rr >= fr && rr < fr + 7 && cc >= fc && cc < fc + 7)
  const finderOn = (rr: number, cc: number) =>
    finders.some(([fr, fc]) => {
      const lr = rr - fr
      const lc = cc - fc
      if (lr < 0 || lr > 6 || lc < 0 || lc > 6) return false
      const ring = lr === 0 || lr === 6 || lc === 0 || lc === 6
      const core = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4
      return ring || core
    })
  const cells: ReactNode[] = []
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const on = isFinder(r, c) ? finderOn(r, c) : rnd() > 0.52
      if (on) cells.push(<rect key={`${r}-${c}`} x={c} y={r} width="1" height="1" fill={T.ink} />)
    }
  return (
    <svg width={size} height={size} viewBox={`-1 -1 ${N + 2} ${N + 2}`} style={{ borderRadius: 8, background: T.card, display: 'block' }} shapeRendering="crispEdges">
      {cells}
    </svg>
  )
}

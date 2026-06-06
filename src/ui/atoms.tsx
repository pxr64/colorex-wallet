// Shared UI atoms + icons, ported from the design handoff (wallet-core.jsx `I`
// and wallet-sign.jsx `SIG_I`, plus the Mono/Eyebrow/Tag/Live/AssetIcon atoms).
// Only the subset used by the signature screen is included; extend as more
// screens are ported.

import type { CSSProperties, ReactNode, SVGProps } from 'react'
import { T } from './theme'

type IconProps = SVGProps<SVGSVGElement>

export const Icon = {
  arrow: (p: IconProps) => (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" {...p}>
      <path d="M3 7h8m0 0L7.5 3.5M11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (p: IconProps) => (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" {...p}>
      <path d="M2.5 7.5 6 11l5.5-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chev: (p: IconProps) => (
    <svg viewBox="0 0 12 12" width="11" height="11" fill="none" {...p}>
      <path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (p: IconProps) => (
    <svg viewBox="0 0 14 14" width="13" height="13" fill="none" {...p}>
      <rect x="2.5" y="6" width="9" height="6.5" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4.5 6V4.3a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  x: (p: IconProps) => (
    <svg viewBox="0 0 14 14" width="12" height="12" fill="none" {...p}>
      <path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  globe: (p: IconProps) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" {...p}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2 8h12M8 2c1.8 1.6 1.8 10.4 0 12M8 2C6.2 3.6 6.2 12.4 8 14" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  pen: (p: IconProps) => (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" {...p}>
      <path d="M10.8 2.6 13.4 5.2 5.6 13H3v-2.6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M9.4 4l2.6 2.6" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  alert: (p: IconProps) => (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" {...p}>
      <path d="M8 2.5 14.5 13.5H1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 6.5v3.2M8 11.4v.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
}

export function Mono({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <span style={{ fontFamily: T.mono, ...style }}>{children}</span>
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: T.mono,
        fontSize: 10,
        color: T.mute,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        ...style,
      }}
    >
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
    <span
      style={{
        fontFamily: T.mono,
        fontSize: small ? 8.5 : 9,
        letterSpacing: '0.07em',
        textTransform: 'uppercase',
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.bd}`,
        padding: small ? '1px 5px' : '2px 6px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {children}
    </span>
  )
}

export function Live({ label = 'live', color = T.ok }: { label?: string; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        fontFamily: T.mono,
        fontSize: 9.5,
        color: T.mute,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      <span className="cxw-pulse" style={{ width: 5, height: 5, borderRadius: 999, background: color }} />
      {label}
    </span>
  )
}

const ASSET_GLYPH: Record<string, string> = {
  tBTC: '₿',
  BTC: '₿',
  RGBX: 'RX',
  'USDT-RGB': '₮',
  'USDC-RGB': 'C',
}

export function AssetIcon({ sym, isRgb, size = 36 }: { sym: string; isRgb: boolean; size?: number }) {
  const glyph = ASSET_GLYPH[sym] ?? sym.slice(0, 2)
  const isBtc = !isRgb
  return (
    <span
      style={{
        width: size,
        height: size,
        flex: '0 0 auto',
        borderRadius: isBtc ? 999 : size * 0.26,
        border: `1px solid ${isBtc ? T.ink : T.hairStrong}`,
        background: isBtc ? T.ink : T.card,
        color: isBtc ? T.bg : T.ink,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: T.mono,
        fontWeight: 500,
        fontSize: glyph.length > 1 ? size * 0.3 : size * 0.46,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {isRgb && (
        <span
          style={{
            position: 'absolute',
            top: size * 0.13,
            right: size * 0.13,
            width: size * 0.085,
            height: size * 0.085,
            borderRadius: 999,
            background: T.accent,
          }}
        />
      )}
      {glyph}
    </span>
  )
}

// 4-dot mark, one accent — ported from wallet-core.jsx.
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

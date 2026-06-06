// Shared chrome ported from the handoff (wallet-ui.jsx): TopBar, SubHeader,
// CopyChip, ActionBtn.

import { type ReactNode, useState } from 'react'
import { T } from './theme'
import { AccountAvatar, Icon, Mono } from './atoms'
import { ACCOUNT } from './data'

export function TopBar({ onLock }: { onLock: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px' }}>
      <button className="cxw-btn" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 9px 5px 6px', border: `1px solid ${T.hair}`, borderRadius: 999, background: T.card }}>
        <AccountAvatar size={24} hue={ACCOUNT.avatarHue} />
        <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 500, color: T.ink }}>{ACCOUNT.name}</span>
        <Icon.chev style={{ color: T.mute }} />
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', border: `1px solid ${T.hair}`, borderRadius: 999, background: T.card }}>
          <span className="cxw-pulse" style={{ width: 5, height: 5, borderRadius: 999, background: T.ok }} />
          <Mono style={{ fontSize: 9.5, color: T.mute, letterSpacing: '0.05em' }}>signet</Mono>
        </span>
        <button className="cxw-btn" onClick={onLock} title="Lock" style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.hair}`, borderRadius: 9, background: T.card, color: T.inkSoft }}>
          <Icon.lock />
        </button>
      </div>
    </div>
  )
}

export function SubHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 12px' }}>
      <button className="cxw-btn" onClick={onBack} style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.hair}`, borderRadius: 9, background: T.card, color: T.ink }}>
        <Icon.back />
      </button>
      <span style={{ fontFamily: T.body, fontSize: 16, fontWeight: 600, color: T.ink, letterSpacing: '-0.01em', marginRight: 'auto' }}>{title}</span>
      {right}
    </div>
  )
}

export function CopyChip({ text, label }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  function copy() {
    void navigator.clipboard?.writeText(text).catch(() => {})
    setDone(true)
    setTimeout(() => setDone(false), 1300)
  }
  return (
    <button className="cxw-btn" onClick={copy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px', border: `1px solid ${T.hair}`, borderRadius: 8, background: T.card, color: done ? T.ok : T.inkSoft, fontFamily: T.mono, fontSize: 10.5 }}>
      {done ? <Icon.check /> : <Icon.copy />}
      {done ? 'Copied' : label || 'Copy'}
    </button>
  )
}

export function ActionBtn({ icon, label, onClick, primary }: { icon: ReactNode; label: string; onClick: () => void; primary?: boolean }) {
  return (
    <button className="cxw-btn" onClick={onClick} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '12px 4px 10px', borderRadius: 13, cursor: 'pointer', border: `1px solid ${primary ? T.accent : T.hair}`, background: primary ? T.accent : T.bg, color: primary ? T.accentInk : T.ink, boxShadow: primary ? '0 8px 20px -12px rgba(184,90,44,0.7)' : 'none' }}>
      <span style={{ display: 'inline-flex' }}>{icon}</span>
      <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 500 }}>{label}</span>
    </button>
  )
}

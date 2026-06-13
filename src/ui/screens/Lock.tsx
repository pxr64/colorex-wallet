import { useEffect, useRef, useState } from 'react'
import { T } from '../theme'
import { Icon, Logo, Mono } from '../atoms'
import { unlock } from '../../wallet/store'

function fmtDuration(ms: number): string {
  const s = Math.ceil(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.ceil(s / 60)
  return m < 60 ? `${m} min` : `${Math.ceil(m / 60)} h`
}

// Lock screen — decrypts the encrypted seed vault with the password (real:
// wrong password → AES-GCM auth failure → stays locked). Wrong guesses are
// rate-limited with escalating, persistent lockouts (#1).
export function Lock({ onUnlock, onSetup }: { onUnlock: () => void; onSetup: () => void }) {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // While > 0, the wallet is locked out — disable submit and count down.
  const [lockMs, setLockMs] = useState(0)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  useEffect(() => {
    if (lockMs <= 0) return
    const t = setInterval(() => setLockMs((m) => Math.max(0, m - 1000)), 1000)
    return () => clearInterval(t)
  }, [lockMs > 0])
  const err = msg !== null
  const submit = async () => {
    if (!pw || busy || lockMs > 0) {
      if (!pw) setMsg('Enter your password.')
      return
    }
    setBusy(true)
    const res = await unlock(pw)
    setBusy(false)
    if (res.ok) {
      onUnlock()
      return
    }
    switch (res.reason) {
      case 'wrong':
        setMsg(
          res.triesLeft > 0
            ? `Incorrect password — ${res.triesLeft} ${res.triesLeft === 1 ? 'try' : 'tries'} left before a lockout.`
            : 'Incorrect password.',
        )
        break
      case 'locked':
        setLockMs(res.retryInMs)
        setMsg(`Too many attempts. Try again in ${fmtDuration(res.retryInMs)}.`)
        break
      case 'wiped':
        setMsg('Too many attempts — wallet erased. Restore from your recovery phrase.')
        break
      case 'no-wallet':
        onSetup()
        break
    }
  }
  return (
    <div className="cxw-in" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 24px', background: T.bg }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Logo size={46} />
        <div style={{ fontFamily: T.body, fontSize: 22, fontWeight: 600, color: T.ink, letterSpacing: '-0.02em', marginTop: 22 }}>Welcome back</div>
        <Mono style={{ fontSize: 11, color: T.mute }}><span style={{ display: 'block', marginTop: 7 }}>Colorex · RGB wallet</span></Mono>

        <div style={{ width: '100%', marginTop: 34 }}>
          <div className="cxw-field" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 50, border: `1px solid ${err ? T.accent : T.hairStrong}`, borderRadius: 13, background: T.card }}>
            <span style={{ color: T.faint, flex: '0 0 auto' }}><Icon.lock /></span>
            <input
              ref={ref}
              className="cxw-input"
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value)
                if (lockMs <= 0) setMsg(null)
              }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Password"
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 15, color: T.ink, letterSpacing: show ? 0 : '0.18em' }}
            />
            <button className="cxw-btn" onClick={() => setShow((v) => !v)} style={{ border: 'none', background: 'transparent', color: T.faint, padding: 4 }}>
              {show ? <Icon.eyeOff /> : <Icon.eye />}
            </button>
          </div>
          {msg && <Mono style={{ fontSize: 10.5, color: T.accent }}><span style={{ display: 'block', marginTop: 8 }}>{lockMs > 0 ? `Too many attempts. Try again in ${fmtDuration(lockMs)}.` : msg}</span></Mono>}

          <button className="cxw-btn" disabled={busy || lockMs > 0} onClick={submit} style={{ width: '100%', marginTop: 14, height: 50, border: 'none', borderRadius: 13, background: T.accent, color: T.accentInk, fontFamily: T.body, fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 10px 26px -12px rgba(184,90,44,0.7)', opacity: lockMs > 0 ? 0.6 : 1 }}>
            {busy ? 'Unlocking…' : lockMs > 0 ? `Locked · ${fmtDuration(lockMs)}` : 'Unlock'} <Icon.arrow />
          </button>
        </div>
      </div>

      <div style={{ textAlign: 'center', paddingBottom: 26, display: 'grid', gap: 12 }}>
        <span className="cxw-link" style={{ fontFamily: T.body, fontSize: 12.5 }}>Forgot password? Restore from recovery phrase</span>
        <div style={{ height: 1, background: T.hair }} />
        <span onClick={onSetup} className="cxw-link" style={{ fontFamily: T.body, fontSize: 12.5, color: T.accent, fontWeight: 500 }}>Set up a new wallet</span>
      </div>
    </div>
  )
}

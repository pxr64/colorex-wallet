import { useEffect, useRef, useState } from 'react'
import { T } from '../theme'
import { Icon, Logo, Mono } from '../atoms'

// Lock screen — ported from wallet-ui.jsx. (Password check is a placeholder until
// the encrypted-seed vault lands; any ≥4-char password unlocks.)
export function Lock({ onUnlock, onSetup }: { onUnlock: () => void; onSetup: () => void }) {
  const [pw, setPw] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  const submit = () => {
    if (pw.length < 4) {
      setErr(true)
      return
    }
    onUnlock()
  }
  return (
    <div className="cxw-in" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 24px', background: T.bg }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <Logo size={46} />
        <div style={{ fontFamily: T.body, fontSize: 22, fontWeight: 600, color: T.ink, letterSpacing: '-0.02em', marginTop: 22 }}>Welcome back</div>
        <Mono style={{ fontSize: 11, color: T.mute }}><span style={{ display: 'block', marginTop: 7 }}>Colorex · RGB wallet</span></Mono>

        <div style={{ width: '100%', marginTop: 34 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 50, border: `1px solid ${err ? T.accent : T.hairStrong}`, borderRadius: 13, background: T.card }}>
            <span style={{ color: T.faint, flex: '0 0 auto' }}><Icon.lock /></span>
            <input
              ref={ref}
              className="cxw-input"
              type={show ? 'text' : 'password'}
              value={pw}
              onChange={(e) => {
                setPw(e.target.value)
                setErr(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="Password"
              style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 15, color: T.ink, letterSpacing: show ? 0 : '0.18em' }}
            />
            <button className="cxw-btn" onClick={() => setShow((v) => !v)} style={{ border: 'none', background: 'transparent', color: T.faint, padding: 4 }}>
              {show ? <Icon.eyeOff /> : <Icon.eye />}
            </button>
          </div>
          {err && <Mono style={{ fontSize: 10.5, color: T.accent }}><span style={{ display: 'block', marginTop: 8 }}>Enter your password to continue</span></Mono>}

          <button className="cxw-btn" onClick={submit} style={{ width: '100%', marginTop: 14, height: 50, border: 'none', borderRadius: 13, background: T.accent, color: T.accentInk, fontFamily: T.body, fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 10px 26px -12px rgba(184,90,44,0.7)' }}>
            Unlock <Icon.arrow />
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

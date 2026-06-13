import { useMemo, useState } from 'react'
import { T } from '../theme'
import { Icon, Logo, Mono } from '../atoms'
import { createWallet, receiveAddress } from '../../wallet/store'
import { passwordStrength } from '../../wallet/password'

interface Generated {
  mnemonic: string
  address: string
}

// Real onboarding: set a password, generate a BIP-39 wallet (JS), encrypt the
// seed under that password (WebCrypto, see vault.ts), init + persist the RGB
// stock (wasm). The plaintext seed is held only in memory after this.
export function Onboarding({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [show, setShow] = useState(false)
  const [gen, setGen] = useState<Generated | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const strength = useMemo(() => passwordStrength(pw), [pw])
  const canCreate = strength.ok && pw === pw2

  async function create() {
    if (!strength.ok) {
      setError(strength.hint ?? 'Choose a stronger password.')
      return
    }
    if (pw !== pw2) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const w = await createWallet(pw)
      const address = (await receiveAddress()) ?? ''
      setGen({ mnemonic: w.mnemonic, address })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cxw-in" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: '0 22px 22px', background: T.bg }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 16, overflowY: 'auto' }}>
        {!gen ? (
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ textAlign: 'center', display: 'grid', gap: 10, justifyItems: 'center' }}>
              <Logo size={40} />
              <div style={{ fontFamily: T.body, fontSize: 21, fontWeight: 600, letterSpacing: '-0.02em', color: T.ink }}>Set up your wallet</div>
              <Mono style={{ fontSize: 11, color: T.mute }}>
                <span style={{ display: 'block', maxWidth: 280, lineHeight: 1.55 }}>
                  Choose a password. It encrypts your seed on this device — keys are
                  generated locally and never leave it.
                </span>
              </Mono>
            </div>
            <div style={{ display: 'grid', gap: 9 }}>
              <PwInput value={pw} onChange={setPw} show={show} onToggle={() => setShow((v) => !v)} placeholder="Password (min 8)" />
              {pw && <StrengthMeter score={strength.score} label={strength.label} hint={strength.hint} />}
              <PwInput value={pw2} onChange={setPw2} show={show} onToggle={() => setShow((v) => !v)} placeholder="Confirm password" />
              {pw2 && pw !== pw2 && (
                <Mono style={{ fontSize: 10, color: T.accent }}>Passwords don't match.</Mono>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ textAlign: 'center', display: 'grid', gap: 4, justifyItems: 'center', marginBottom: 4 }}>
              <span className="cxw-pop" style={{ width: 48, height: 48, borderRadius: 999, background: T.okSoft, border: `1px solid ${T.ok}`, color: T.ok, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon.check style={{ width: 22, height: 22 }} />
              </span>
              <div style={{ fontFamily: T.body, fontSize: 18, fontWeight: 600, color: T.ink }}>Wallet created</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', border: `1px dashed ${T.hairStrong}`, borderRadius: 12, background: T.accentSoft }}>
              <span style={{ color: T.accent, flex: '0 0 auto', marginTop: 1 }}><Icon.shield /></span>
              <Mono style={{ fontSize: 10.5, color: T.inkSoft }}><span style={{ lineHeight: 1.5 }}>Write down your recovery phrase and store it offline. It's the only way to restore this wallet.</span></Mono>
            </div>
            <Field label="Recovery phrase">{gen.mnemonic}</Field>
            <Field label="RGB receive address (keychain-10)">{gen.address}</Field>
          </div>
        )}

        {error && (
          <div style={{ border: `1px solid ${T.warn}`, borderRadius: 12, padding: '10px 12px', background: T.okSoft }}>
            <Mono style={{ fontSize: 11, color: T.warn }}>{error}</Mono>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 10 }}>
        {!gen ? (
          <button className="cxw-btn" disabled={busy || !canCreate} onClick={create} style={primaryBtn}>
            {busy ? 'Generating…' : 'Create wallet'}
          </button>
        ) : (
          <button className="cxw-btn" onClick={onDone} style={primaryBtn}>
            I've saved it — continue <Icon.arrow />
          </button>
        )}
        <button className="cxw-btn" onClick={onBack} style={{ border: 'none', background: 'transparent', color: T.mute, fontFamily: T.body, fontSize: 12.5, padding: 4 }}>
          Back
        </button>
      </div>
    </div>
  )
}

function PwInput({ value, onChange, show, onToggle, placeholder }: { value: string; onChange: (v: string) => void; show: boolean; onToggle: () => void; placeholder: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 48, border: `1px solid ${T.hairStrong}`, borderRadius: 12, background: T.card }}>
      <span style={{ color: T.faint, flex: '0 0 auto' }}><Icon.lock /></span>
      <input
        className="cxw-input"
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ flex: 1, minWidth: 0, border: 'none', background: 'transparent', fontSize: 14, color: T.ink }}
      />
      <button className="cxw-btn" onClick={onToggle} style={{ border: 'none', background: 'transparent', color: T.faint, padding: 4 }}>
        {show ? <Icon.eyeOff /> : <Icon.eye />}
      </button>
    </div>
  )
}

function StrengthMeter({ score, label, hint }: { score: number; label: string; hint?: string }) {
  // 0 very weak → 4 very strong. Color ramps red → amber → green.
  const color = score <= 0 ? T.accent : score === 1 ? T.warn : score === 2 ? T.warn : T.ok
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i < score ? color : T.hairStrong,
              transition: 'background 160ms ease',
            }}
          />
        ))}
      </div>
      <Mono style={{ fontSize: 9.5, color: score >= 3 ? T.ok : T.mute }}>
        {label}
        {hint ? ` · ${hint}` : ''}
      </Mono>
    </div>
  )
}

const primaryBtn = {
  height: 50,
  border: 'none',
  borderRadius: 13,
  background: T.accent,
  color: T.accentInk,
  fontFamily: T.body,
  fontSize: 15,
  fontWeight: 600,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  boxShadow: '0 10px 26px -12px rgba(184,90,44,0.7)',
} as const

function Field({ label, children }: { label: string; children: string }) {
  return (
    <div style={{ border: `1px solid ${T.hair}`, borderRadius: 12, padding: '9px 12px', background: T.card }}>
      <Mono style={{ fontSize: 9.5, color: T.mute, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{label}</Mono>
      <div style={{ marginTop: 4 }}>
        <Mono style={{ fontSize: 11.5, color: T.ink, wordBreak: 'break-all', lineHeight: 1.5 }}>{children}</Mono>
      </div>
    </div>
  )
}

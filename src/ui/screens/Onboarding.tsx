import { useState } from 'react'
import { T } from '../theme'
import { Icon, Logo, Mono } from '../atoms'
import { createWallet, receiveAddress } from '../../wallet/store'

interface Generated {
  mnemonic: string
  address: string
}

// Real onboarding: generate keys in JS, init + persist the RGB stock (wasm) via
// the store, and show the wallet. (Encrypted-seed vault is a later milestone; the
// non-secret descriptor is persisted so the wallet survives reopens.)
export function Onboarding({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const [gen, setGen] = useState<Generated | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const w = await createWallet()
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
          <div style={{ textAlign: 'center', display: 'grid', gap: 12, justifyItems: 'center' }}>
            <Logo size={42} />
            <div style={{ fontFamily: T.body, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: T.ink }}>Set up your wallet</div>
            <Mono style={{ fontSize: 11.5, color: T.mute }}>
              <span style={{ display: 'block', maxWidth: 280, lineHeight: 1.6 }}>
                Self-custodial RGB-on-Bitcoin. Keys are generated on this device; the
                RGB engine + wallet run locally in WebAssembly.
              </span>
            </Mono>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ textAlign: 'center', display: 'grid', gap: 4, justifyItems: 'center', marginBottom: 4 }}>
              <span className="cxw-pop" style={{ width: 48, height: 48, borderRadius: 999, background: T.okSoft, border: `1px solid ${T.ok}`, color: T.ok, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon.check style={{ width: 22, height: 22 }} />
              </span>
              <div style={{ fontFamily: T.body, fontSize: 18, fontWeight: 600, color: T.ink }}>Wallet created</div>
            </div>
            <Field label="RGB receive address (keychain-10)">{gen.address}</Field>
            <Field label="Recovery phrase — write it down">{gen.mnemonic}</Field>
            <Mono style={{ fontSize: 10, color: T.faint, textAlign: 'center' }}>RGB engine + wallet running in wasm · persisted on-device</Mono>
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
          <button className="cxw-btn" disabled={busy} onClick={create} style={primaryBtn}>
            {busy ? 'Generating…' : 'Generate signet wallet'}
          </button>
        ) : (
          <button className="cxw-btn" onClick={onDone} style={primaryBtn}>
            Continue to wallet <Icon.arrow />
          </button>
        )}
        <button className="cxw-btn" onClick={onBack} style={{ border: 'none', background: 'transparent', color: T.mute, fontFamily: T.body, fontSize: 12.5, padding: 4 }}>
          Back
        </button>
      </div>
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

import { useState } from 'react'
import { T } from '../theme'
import { Logo, Mono } from '../atoms'
import { generateWallet } from '../../wallet/keys'
import { rgbReady, wasm } from '../../wallet/rgb'

interface RunResult {
  version: string
  mnemonic: string
  address: string
  schemaCount: number
  bytes: { stash: number; state: number; index: number }
}

// First runnable wallet surface: generate a wallet in JS, derive its receive
// address + initialize the RGB stock in wasm, and show it — proving the full
// RGB + bitcoin engine runs inside the extension. Onboarding/UX polish follows.
export function Home() {
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      const { mnemonic, descriptor } = generateWallet()
      await rgbReady()
      const address = wasm.derive_keychain10_address(descriptor, 'signet')
      const stock = new wasm.RgbStock()
      const snap = stock.save()
      setResult({
        version: wasm.version(),
        mnemonic,
        address,
        schemaCount: stock.schema_count(),
        bytes: { stash: snap.stash.length, state: snap.state.length, index: snap.index.length },
      })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ padding: 18, height: '100%', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Logo size={22} />
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>Colorex Wallet</h1>
      </div>

      <p style={{ color: T.mute, fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
        RGB-on-Bitcoin, self-custodial. The RGB engine + bitcoin wallet run on-device
        in WebAssembly. Tap below to generate a signet wallet — keys are derived in
        JS, the address + RGB stock come from wasm.
      </p>

      <button
        className="cxw-btn"
        disabled={busy}
        onClick={run}
        style={{ height: 46, border: 'none', borderRadius: 13, background: T.accent, color: T.accentInk, fontFamily: T.body, fontSize: 14.5, fontWeight: 600, boxShadow: '0 10px 26px -12px rgba(184,90,44,0.7)' }}
      >
        {busy ? 'Generating…' : 'Generate signet wallet'}
      </button>

      {error && (
        <div style={{ border: `1px solid ${T.warn}`, borderRadius: 12, padding: '10px 12px', background: T.okSoft }}>
          <Mono style={{ fontSize: 11, color: T.warn }}>{error}</Mono>
        </div>
      )}

      {result && (
        <div style={{ display: 'grid', gap: 10 }}>
          <Field label="RGB receive address (keychain-10)">{result.address}</Field>
          <Field label="Recovery phrase">{result.mnemonic}</Field>
          <div style={{ display: 'flex', gap: 8 }}>
            <Stat label="engine" value={result.version.replace('rgb-wasm ', 'v')} />
            <Stat label="schemas" value={String(result.schemaCount)} />
            <Stat label="stash" value={`${result.bytes.stash}B`} />
          </div>
          <Mono style={{ fontSize: 10, color: T.faint, textAlign: 'center' }}>
            RGB stock initialized + serialized in wasm · ready for IndexedDB
          </Mono>
        </div>
      )}

      <p style={{ color: T.faint, fontSize: 10.5, marginTop: 'auto' }}>
        Preview the signature approval at <code style={{ fontFamily: T.mono, color: T.accent }}>index.html?id=mock</code>
      </p>
    </main>
  )
}

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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, border: `1px solid ${T.hair}`, borderRadius: 10, padding: '7px 9px', background: T.bg, textAlign: 'center' }}>
      <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink }}>{value}</div>
      <Mono style={{ fontSize: 8.5, color: T.faint, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</Mono>
    </div>
  )
}

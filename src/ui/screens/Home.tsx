import { useEffect, useState } from 'react'
import { T } from '../theme'
import { AssetIcon, Eyebrow, Icon, Mono, Tag } from '../atoms'
import { TopBar, CopyChip } from '../chrome'
import { ASSETS } from '../data'
import { type Asset, formatUnits, importAsset, listAssets, receiveAddress } from '../../wallet/store'

// Lean, sign-centric Home. The asset list is fully dynamic (from the wasm RGB
// stock via the store). Import accepts a consignment (Esplora resolver edge).
export function Home({ onLock, onSign }: { onLock: () => void; onSign: () => void }) {
  const [assets, setAssets] = useState<Asset[] | null>(null)
  const [addr, setAddr] = useState<string | undefined>()
  const [showImport, setShowImport] = useState(false)
  const [consignment, setConsignment] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  useEffect(() => {
    void listAssets().then(setAssets).catch(() => setAssets([]))
    void receiveAddress().then(setAddr).catch(() => undefined)
  }, [])

  async function doImport() {
    setImporting(true)
    setImportMsg(null)
    try {
      await importAsset(consignment)
      setAssets(await listAssets())
      setConsignment('')
      setShowImport(false)
    } catch (e) {
      setImportMsg((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar onLock={onLock} />
      <div className="cxw-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 18px', display: 'grid', gap: 16, alignContent: 'start' }}>
        {/* signature requests — the MVP centerpiece */}
        <div className="cxw-in" style={{ borderRadius: 16, border: `1px solid ${T.hair}`, background: T.card, padding: '15px 16px', boxShadow: '0 16px 36px -28px rgba(20,16,12,0.4)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
            <span style={{ width: 30, height: 30, borderRadius: 9, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.hairStrong}`, background: T.bg, color: T.accent }}><Icon.pen /></span>
            <div style={{ display: 'grid', gap: 1 }}>
              <span style={{ fontFamily: T.body, fontSize: 14, fontWeight: 600, color: T.ink }}>Signature requests</span>
              <Mono style={{ fontSize: 10, color: T.faint }}>from app.colorex.exchange</Mono>
            </div>
          </div>
          <Mono style={{ fontSize: 11, color: T.mute }}><span style={{ display: 'block', lineHeight: 1.55, marginBottom: 11 }}>No pending requests. When a Colorex swap needs your signature, the approval prompt opens here.</span></Mono>
          <button className="cxw-btn" onClick={onSign} style={{ width: '100%', height: 44, border: `1px solid ${T.accent}`, borderRadius: 12, background: T.accentSoft, color: T.accent, fontFamily: T.body, fontSize: 13.5, fontWeight: 600 }}>
            Open a sample request
          </button>
        </div>

        {/* receive address */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
            <Eyebrow>Your RGB receive address</Eyebrow>
            {addr && <CopyChip text={addr} />}
          </div>
          <div style={{ border: `1px solid ${T.hair}`, borderRadius: 13, background: T.bg, padding: '12px 14px' }}>
            <Mono style={{ fontSize: 11.5, color: addr ? T.ink : T.faint }}><span style={{ lineHeight: 1.6, wordBreak: 'break-all' }}>{addr ?? 'No wallet yet.'}</span></Mono>
          </div>
        </div>

        {/* dynamic asset list */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 2px 7px' }}>
            <Eyebrow>Assets</Eyebrow>
            <button className="cxw-btn" onClick={() => setShowImport((v) => !v)} style={{ border: 'none', background: 'transparent', color: T.accent, fontFamily: T.mono, fontSize: 10, letterSpacing: '0.04em', padding: 0 }}>
              {showImport ? 'cancel' : '+ import'}
            </button>
          </div>

          {showImport && (
            <div className="cxw-in" style={{ border: `1px solid ${T.hair}`, borderRadius: 13, background: T.card, padding: 12, marginBottom: 10, display: 'grid', gap: 9 }}>
              <textarea
                className="cxw-input"
                value={consignment}
                onChange={(e) => setConsignment(e.target.value)}
                rows={3}
                placeholder="Paste an RGB consignment (base64)…"
                style={{ width: '100%', border: `1px solid ${T.hair}`, borderRadius: 9, background: T.bg, resize: 'none', fontFamily: T.mono, fontSize: 11, color: T.ink, lineHeight: 1.5, padding: '8px 10px' }}
              />
              <button className="cxw-btn" disabled={importing || !consignment.trim()} onClick={doImport} style={{ height: 40, border: 'none', borderRadius: 11, background: T.accent, color: T.accentInk, fontFamily: T.body, fontSize: 13, fontWeight: 600 }}>
                {importing ? 'Importing…' : 'Import asset'}
              </button>
            </div>
          )}

          {assets && assets.length === 0 && !showImport && (
            <div style={{ border: `1px dashed ${T.hairStrong}`, borderRadius: 13, padding: '16px 14px', textAlign: 'center' }}>
              <Mono style={{ fontSize: 11, color: T.mute }}><span style={{ lineHeight: 1.55 }}>No RGB assets yet. Import one (by consignment) to track it.</span></Mono>
            </div>
          )}

          {assets && assets.length > 0 && (
            <div className="cxw-stagger" style={{ display: 'grid', gap: 1 }}>
              {assets.map((a) => (
                <AssetRow key={a.contractId} a={a} />
              ))}
            </div>
          )}

          {importMsg && <Mono style={{ fontSize: 10.5, color: T.warn }}><span style={{ display: 'block', marginTop: 10, lineHeight: 1.5 }}>{importMsg}</span></Mono>}
        </div>
      </div>
    </div>
  )
}

function AssetRow({ a }: { a: Asset }) {
  const isBtc = ASSETS[a.ticker]?.kind === 'btc'
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center', padding: '11px 12px', borderRadius: 13 }}>
      <AssetIcon sym={a.ticker} size={38} isRgb={!isBtc} />
      <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: T.body, fontSize: 14, fontWeight: 500, color: T.ink }}>{a.ticker}</span>
          {!isBtc && <Tag tone="rgb" small>RGB</Tag>}
        </span>
        <Mono style={{ fontSize: 10, color: T.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.contractId}</Mono>
      </div>
      <span className="cxw-tab" style={{ fontFamily: T.body, fontSize: 14, fontWeight: 500, color: T.ink }}>{formatUnits(a.balance, a.precision)}</span>
    </div>
  )
}

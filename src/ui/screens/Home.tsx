import { useEffect, useState } from 'react'
import { T } from '../theme'
import { AssetIcon, Eyebrow, Icon, Live, Mono, Tag } from '../atoms'
import { ActionBtn, CopyChip, TopBar } from '../chrome'
import { ASSETS } from '../data'
import {
  type Asset,
  type WalletSnapshot,
  formatUnits,
  importAsset,
  receiveAddress,
  walletSnapshot,
} from '../../wallet/store'

// The wallet home — design-faithful (balance card → actions → assets), fully
// dynamic: the balance is the wallet's real BTC (Esplora UTXO scan) and the asset
// list is whatever the RGB stock holds. Sign is the primary action (the MVP).
export function Home({ onLock, onSign }: { onLock: () => void; onSign: () => void }) {
  const [snap, setSnap] = useState<WalletSnapshot | null>(null)
  const [addr, setAddr] = useState<string | undefined>()
  const [panel, setPanel] = useState<'none' | 'receive' | 'import'>('none')
  const [consignment, setConsignment] = useState('')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<string | null>(null)

  function refresh() {
    void walletSnapshot()
      .then(setSnap)
      .catch(() => setSnap({ btcSats: 0, assets: [] }))
  }
  useEffect(() => {
    refresh()
    void receiveAddress().then(setAddr).catch(() => undefined)
  }, [])

  async function doImport() {
    setImporting(true)
    setImportMsg(null)
    try {
      await importAsset(consignment)
      refresh()
      setConsignment('')
      setPanel('none')
    } catch (e) {
      setImportMsg((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  const assets = snap?.assets ?? []
  const btc = snap ? formatUnits(snap.btcSats, 8) : '…'

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <TopBar onLock={onLock} />
      <div className="cxw-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 16px 18px' }}>
        {/* balance card */}
        <div className="cxw-in" style={{ borderRadius: 18, border: `1px solid ${T.hair}`, background: T.card, padding: '20px 18px 16px', boxShadow: '0 1px 0 rgba(255,255,255,0.6) inset, 0 16px 36px -28px rgba(20,16,12,0.4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Eyebrow>Total balance</Eyebrow>
            <Live label={snap ? 'synced' : 'syncing'} />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="cxw-tab" style={{ fontFamily: T.body, fontSize: 36, fontWeight: 560, letterSpacing: '-0.03em', color: T.ink }}>{btc}</span>
            <span style={{ fontFamily: T.body, fontSize: 15, fontWeight: 500, color: T.mute }}>tBTC</span>
          </div>
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mono className="cxw-tab" style={{ fontSize: 11, color: T.mute }}>
              {assets.length} RGB asset{assets.length === 1 ? '' : 's'}
            </Mono>
            <span style={{ width: 3, height: 3, borderRadius: 999, background: T.faint }} />
            <Mono className="cxw-tab" style={{ fontSize: 11, color: T.mute }}>{snap ? `${snap.btcSats.toLocaleString('en-US')} sats` : '—'}</Mono>
          </div>

          {/* actions */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 18 }}>
            <ActionBtn icon={<Icon.down />} label="Receive" onClick={() => setPanel((p) => (p === 'receive' ? 'none' : 'receive'))} />
            <ActionBtn icon={<Icon.pen />} label="Sign" onClick={onSign} primary />
            <ActionBtn icon={<Icon.paste />} label="Import" onClick={() => setPanel((p) => (p === 'import' ? 'none' : 'import'))} />
          </div>
        </div>

        {/* receive panel */}
        {panel === 'receive' && (
          <div className="cxw-in" style={{ marginTop: 12, border: `1px solid ${T.hair}`, borderRadius: 14, background: T.bg, padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <Eyebrow>RGB receive address</Eyebrow>
              {addr && <CopyChip text={addr} />}
            </div>
            <Mono style={{ fontSize: 11.5, color: addr ? T.ink : T.faint }}>
              <span style={{ lineHeight: 1.6, wordBreak: 'break-all' }}>{addr ?? 'No wallet.'}</span>
            </Mono>
          </div>
        )}

        {/* import panel */}
        {panel === 'import' && (
          <div className="cxw-in" style={{ marginTop: 12, border: `1px solid ${T.hair}`, borderRadius: 14, background: T.bg, padding: 14, display: 'grid', gap: 9 }}>
            <Eyebrow>Import asset</Eyebrow>
            <textarea
              className="cxw-input"
              value={consignment}
              onChange={(e) => setConsignment(e.target.value)}
              rows={3}
              placeholder="Paste an RGB consignment (base64)…"
              style={{ width: '100%', border: `1px solid ${T.hair}`, borderRadius: 9, background: T.card, resize: 'none', fontFamily: T.mono, fontSize: 11, color: T.ink, lineHeight: 1.5, padding: '8px 10px' }}
            />
            <button className="cxw-btn" disabled={importing || !consignment.trim()} onClick={doImport} style={{ height: 40, border: 'none', borderRadius: 11, background: T.accent, color: T.accentInk, fontFamily: T.body, fontSize: 13, fontWeight: 600 }}>
              {importing ? 'Importing…' : 'Import'}
            </button>
            {importMsg && <Mono style={{ fontSize: 10.5, color: T.warn }}><span style={{ lineHeight: 1.5 }}>{importMsg}</span></Mono>}
          </div>
        )}

        {/* assets */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '20px 2px 6px' }}>
          <Eyebrow>Assets</Eyebrow>
          <Mono style={{ fontSize: 9.5, color: T.faint }}>{assets.length} held</Mono>
        </div>
        {assets.length === 0 ? (
          <div style={{ border: `1px dashed ${T.hairStrong}`, borderRadius: 13, padding: '16px 14px', textAlign: 'center' }}>
            <Mono style={{ fontSize: 11, color: T.mute }}><span style={{ lineHeight: 1.55 }}>No RGB assets yet. Use Import to add one.</span></Mono>
          </div>
        ) : (
          <div className="cxw-stagger" style={{ display: 'grid', gap: 1 }}>
            {assets.map((a) => (
              <AssetRow key={a.contractId} a={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AssetRow({ a }: { a: Asset }) {
  const isBtc = ASSETS[a.ticker]?.kind === 'btc'
  const name = ASSETS[a.ticker]?.name ?? a.contractId
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center', padding: '11px 12px', borderRadius: 13 }}>
      <AssetIcon sym={a.ticker} size={38} isRgb={!isBtc} />
      <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ fontFamily: T.body, fontSize: 14, fontWeight: 500, color: T.ink }}>{a.ticker}</span>
          {!isBtc && <Tag tone="rgb" small>RGB</Tag>}
        </span>
        <Mono style={{ fontSize: 10.5, color: T.mute, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</Mono>
      </div>
      <span className="cxw-tab" style={{ fontFamily: T.body, fontSize: 14, fontWeight: 500, color: T.ink }}>{formatUnits(a.balance, a.precision)}</span>
    </div>
  )
}

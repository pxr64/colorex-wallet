// Connection approval screen — shown when a dApp calls window.colorex.connect().
// Mirrors SignScreen's approval pattern: fetch the pending ConnectRequest from
// the worker, show the requesting origin + what access is granted, and let the
// user approve or reject. The decision resolves the dApp's connect() promise.

import { useEffect, useState } from 'react'
import { T } from '../theme'
import { Eyebrow, Icon, Mono } from '../atoms'
import type { ConnectRequest, PopupResponse } from '../../worker/messages'

const GRANTS = [
  { label: 'View your account address', sub: 'see your wallet address + balances' },
  { label: 'Request signatures', sub: 'ask you to approve each swap — you confirm every time' },
]

export function ConnectScreen({ requestId }: { requestId: string }) {
  const [req, setReq] = useState<ConnectRequest | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void chrome.runtime
      .sendMessage({ kind: 'getConnectRequest', id: requestId })
      .then((r: PopupResponse) => setReq(r.kind === 'connectRequest' ? r.request : null))
  }, [requestId])

  async function decide(approve: boolean) {
    setBusy(true)
    await chrome.runtime.sendMessage({ kind: 'decideConnect', id: requestId, approve })
    window.close()
  }

  if (!req)
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.mute, fontFamily: T.mono, fontSize: 12 }}>
        Loading request…
      </div>
    )

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* title bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 16px 12px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.hairStrong}`, background: T.card, color: T.accent }}>
          <Icon.globe />
        </span>
        <div style={{ marginRight: 'auto', display: 'grid', gap: 1 }}>
          <span style={{ fontFamily: T.body, fontSize: 16, fontWeight: 600, color: T.ink, letterSpacing: '-0.01em' }}>Connection request</span>
          <Mono style={{ fontSize: 9.5, color: T.faint, letterSpacing: '0.04em' }}>a site wants to connect</Mono>
        </div>
        <button className="cxw-btn" onClick={() => decide(false)} title="Reject" style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.hair}`, borderRadius: 9, background: T.card, color: T.inkSoft }}>
          <Icon.x />
        </button>
      </div>

      <div className="cxw-scroll cxw-slide" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 16px' }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {/* origin */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 13px', border: `1px solid ${T.hair}`, borderRadius: 14, background: T.card }}>
            <span style={{ width: 38, height: 38, flex: '0 0 auto', borderRadius: 11, border: `1px solid ${T.hairStrong}`, background: T.bg, color: T.inkSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon.globe />
            </span>
            <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
              <span style={{ fontFamily: T.body, fontSize: 14, fontWeight: 500, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.origin}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon.lock style={{ width: 9, height: 9, color: T.mute }} />
                <Mono style={{ fontSize: 9.5, color: T.mute, letterSpacing: '0.04em' }}>wants to connect to your wallet</Mono>
              </span>
            </div>
          </div>

          {/* grants */}
          <div style={{ border: `1px solid ${T.hair}`, borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '11px 15px 9px', borderBottom: `1px solid ${T.hair}` }}>
              <Eyebrow>This site will be able to</Eyebrow>
            </div>
            {GRANTS.map((g, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '12px 15px', borderTop: i ? `1px solid ${T.hair}` : 'none', background: i % 2 ? T.bg : T.card }}>
                <span style={{ width: 22, height: 22, flex: '0 0 auto', borderRadius: 999, background: T.okSoft, color: T.ok, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
                  <Icon.check style={{ width: 12, height: 12 }} />
                </span>
                <div style={{ display: 'grid', gap: 2 }}>
                  <span style={{ fontFamily: T.body, fontSize: 13, fontWeight: 500, color: T.ink }}>{g.label}</span>
                  <Mono style={{ fontSize: 10, color: T.mute }}>{g.sub}</Mono>
                </div>
              </div>
            ))}
          </div>

          {/* trust note */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 13px', border: `1px dashed ${T.hairStrong}`, borderRadius: 12 }}>
            <span style={{ color: T.warn, flex: '0 0 auto', marginTop: 1 }}><Icon.alert /></span>
            <Mono style={{ fontSize: 10, color: T.mute }}>
              <span style={{ lineHeight: 1.55 }}>
                Connecting only shares your address. It can't move funds — every swap still needs your signature. Your keys and RGB state never leave this device.
              </span>
            </Mono>
          </div>
        </div>
      </div>

      {/* actions */}
      <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${T.hair}`, background: T.bg, display: 'flex', gap: 10 }}>
        <button className="cxw-btn" disabled={busy} onClick={() => decide(false)} style={{ flex: '0 0 auto', padding: '0 22px', height: 50, border: `1px solid ${T.hairStrong}`, borderRadius: 13, background: T.card, color: T.ink, fontFamily: T.body, fontSize: 14.5, fontWeight: 500 }}>Reject</button>
        <button className="cxw-btn" disabled={busy} onClick={() => decide(true)} style={{ flex: 1, height: 50, border: 'none', borderRadius: 13, background: T.accent, color: T.accentInk, fontFamily: T.body, fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 10px 26px -12px rgba(184,90,44,0.7)' }}>
          <Icon.lock /> Connect
        </button>
      </div>
    </div>
  )
}

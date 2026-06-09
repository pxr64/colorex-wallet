// Signature request screen — faithful port of the design handoff
// (design_handoff_sign_tx/design-reference/wallet-sign.jsx), wired to the live
// SignRequest contract (INTEGRATION.md §4) instead of the prototype's mock.
// State machine: review → signing → done. Amounts are wallet-DERIVED (deltas),
// never trusted from the dApp.

import { useEffect, useState } from 'react'
import { T, fmt, usd } from '../theme'
import { AssetIcon, Eyebrow, Icon, Live, Mono, Tag } from '../atoms'
import type { BalanceDelta, SignRequest, SignResult } from '../../types/sign-request'
import type { PopupResponse } from '../../worker/messages'
import { MOCK_SIGN_REQUEST } from '../mock'

const SIGN_FLOW = [
  { label: 'PSBT verified', sub: 'inputs match · no extra spends' },
  { label: 'Signed locally', sub: 'keys never leave this device' },
  { label: 'Returned to dApp', sub: 'signature handed to the app' },
]

type Step = 'review' | 'signing' | 'done'

export function SignScreen({ requestId, onClose }: { requestId: string; onClose?: () => void }) {
  const isMock = requestId === 'mock'
  const close = onClose ?? (() => window.close())
  const [req, setReq] = useState<SignRequest | null>(null)
  const [step, setStep] = useState<Step>('review')
  const [adv, setAdv] = useState(false)
  const [sigStep, setSigStep] = useState(0)
  const [result, setResult] = useState<SignResult | null>(null)

  useEffect(() => {
    if (isMock) {
      setReq(MOCK_SIGN_REQUEST)
      return
    }
    void chrome.runtime
      .sendMessage({ kind: 'getSignRequest', id: requestId })
      .then((r: PopupResponse) => setReq(r.kind === 'signRequest' ? r.request : null))
  }, [isMock, requestId])

  // Stepper animation while signing. For the mock, also auto-advance to done;
  // for a real request, `done` is driven by the worker's decision result.
  useEffect(() => {
    if (step !== 'signing') return
    setSigStep(0)
    const timers: ReturnType<typeof setTimeout>[] = []
    for (let i = 1; i <= SIGN_FLOW.length; i++) timers.push(setTimeout(() => setSigStep(i), i * 820))
    if (isMock) timers.push(setTimeout(() => setStep('done'), SIGN_FLOW.length * 820 + 480))
    return () => timers.forEach(clearTimeout)
  }, [step, isMock])

  async function reject() {
    if (!isMock) await chrome.runtime.sendMessage({ kind: 'decide', id: requestId, approve: false })
    close()
  }

  async function sign() {
    setStep('signing')
    if (isMock) return
    try {
      // Worker-confined signing (#2): this window holds NO key — it only relays the
      // user's approval. The worker signs req.signInputs with the unlocked account
      // key and resolves the dApp's promise.
      const resp: PopupResponse = await chrome.runtime.sendMessage({ kind: 'decide', id: requestId, approve: true })
      const r = resp.kind === 'decided' ? resp.result : { ok: false as const, error: 'sign_failed' as const }
      setResult(r)
      setStep(r.ok ? 'done' : 'review')
    } catch (e) {
      console.error('[colorex] sign decision failed', e)
      setResult({ ok: false, error: 'sign_failed', message: (e as Error).message })
      setStep('review')
    }
  }

  if (!req)
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.mute, fontFamily: T.mono, fontSize: 12 }}>
        Loading request…
      </div>
    )

  const outflows = req.deltas.filter((d) => d.delta < 0)
  const inflows = req.deltas.filter((d) => d.delta > 0)

  // ============================ SIGNING ============================
  if (step === 'signing') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ color: T.accent }}><Icon.lock /></span>
          <span style={{ fontFamily: T.body, fontSize: 16, fontWeight: 600, color: T.ink, letterSpacing: '-0.01em' }}>Signing</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
          <div style={{ textAlign: 'center', padding: '4px 0 26px' }}>
            <Mono style={{ fontSize: 11, color: T.accent }}>for {req.origin}</Mono>
          </div>
          <div style={{ display: 'grid', paddingLeft: 4 }}>
            {SIGN_FLOW.map((st, i) => {
              const done = i < sigStep
              const active = i === sigStep
              const last = i === SIGN_FLOW.length - 1
              return (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: 14 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <span
                      style={{
                        width: 28, height: 28, borderRadius: 999, flex: '0 0 auto',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        background: done ? T.accent : active ? T.card : T.bg,
                        border: `1px solid ${done || active ? T.accent : T.hairStrong}`,
                        color: done ? '#fff' : T.accent,
                      }}
                    >
                      {done ? (
                        <Icon.check />
                      ) : active ? (
                        <svg className="cxw-spin" viewBox="0 0 14 14" width="13" height="13" fill="none">
                          <circle cx="7" cy="7" r="5" stroke={T.hair} strokeWidth="1.6" />
                          <path d="M7 2a5 5 0 0 1 5 5" stroke={T.accent} strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      ) : (
                        <Mono style={{ fontSize: 10, color: T.faint }}>{i + 1}</Mono>
                      )}
                    </span>
                    {!last && <span style={{ width: 1, flex: 1, minHeight: 26, background: done ? T.accent : T.hair, margin: '2px 0' }} />}
                  </div>
                  <div style={{ paddingBottom: last ? 0 : 24, opacity: i <= sigStep ? 1 : 0.4, transition: 'opacity .3s' }}>
                    <div style={{ fontFamily: T.body, fontSize: 14, fontWeight: 500, color: T.ink }}>{st.label}</div>
                    <Mono style={{ fontSize: 10.5, color: T.mute }}>{st.sub}</Mono>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // ============================ DONE ============================
  if (step === 'done') {
    const summary =
      outflows[0] && inflows[0]
        ? `${fmt(Math.abs(outflows[0].delta), outflows[0].sym)} ${outflows[0].sym} → ${fmt(inflows[0].delta, inflows[0].sym)} ${inflows[0].sym}`
        : '—'
    const txid = result?.ok ? (result.txid ?? 'signed — dApp will broadcast') : isMock ? 'c2e1…7af2:0' : '—'
    const cons = (result?.ok && result.consignment) || req.consignment || (isMock ? 'cons:8b…d4' : '—')
    const artifacts: [string, string][] = [
      ['Signed', summary],
      ['Witness txid', txid],
      ['Consignment', cons],
    ]
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div className="cxw-scroll" style={{ flex: 1, overflowY: 'auto', padding: '46px 22px 16px' }}>
          <div style={{ textAlign: 'center' }}>
            <span className="cxw-pop" style={{ width: 60, height: 60, borderRadius: 999, background: T.okSoft, border: `1px solid ${T.ok}`, color: T.ok, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Icon.check style={{ width: 26, height: 26 }} />
            </span>
            <div style={{ fontFamily: T.body, fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', color: T.ink }}>Signature sent</div>
            <Mono style={{ fontSize: 11, color: T.mute }}>
              <span style={{ display: 'block', marginTop: 8, lineHeight: 1.6 }}>
                Returned to {req.origin}.<br />It will broadcast the swap and settle on {req.network}.
              </span>
            </Mono>
          </div>
          <div style={{ marginTop: 24, border: `1px solid ${T.hair}`, borderRadius: 14, overflow: 'hidden' }}>
            {artifacts.map(([k, v], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 15px', borderTop: i ? `1px solid ${T.hair}` : 'none', background: i % 2 ? T.bg : T.card }}>
                <Mono style={{ fontSize: 10.5, color: T.mute, letterSpacing: '0.03em' }}>{k}</Mono>
                <Mono style={{ fontSize: 11, color: T.ink }}>
                  <span className="cxw-tab" style={{ textAlign: 'right', wordBreak: 'break-all', display: 'block' }}>{v}</span>
                </Mono>
              </div>
            ))}
          </div>
        </div>
        <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${T.hair}`, background: T.bg }}>
          <button className="cxw-btn" onClick={close} style={{ width: '100%', height: 50, border: 'none', borderRadius: 13, background: T.accent, color: T.accentInk, fontFamily: T.body, fontSize: 15, fontWeight: 600, boxShadow: '0 10px 26px -12px rgba(184,90,44,0.7)' }}>
            Done
          </button>
        </div>
      </div>
    )
  }

  // ============================ REVIEW ============================
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* title bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '14px 16px 12px' }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.hairStrong}`, background: T.card, color: T.accent }}>
          <Icon.pen />
        </span>
        <div style={{ marginRight: 'auto', display: 'grid', gap: 1 }}>
          <span style={{ fontFamily: T.body, fontSize: 16, fontWeight: 600, color: T.ink, letterSpacing: '-0.01em' }}>Signature request</span>
          <Mono style={{ fontSize: 9.5, color: T.faint, letterSpacing: '0.04em' }}>{req.action} · PSBT</Mono>
        </div>
        <button className="cxw-btn" onClick={reject} title="Reject" style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.hair}`, borderRadius: 9, background: T.card, color: T.inkSoft }}>
          <Icon.x />
        </button>
      </div>

      <div className="cxw-scroll cxw-slide" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '4px 16px 16px' }}>
        <div style={{ display: 'grid', gap: 12 }}>
          {result && !result.ok && (
            <div style={{ padding: '10px 13px', border: `1px solid ${T.warn}`, borderRadius: 12, background: 'rgba(201,138,46,0.08)' }}>
              <Mono style={{ fontSize: 11, color: T.warn }}>
                <span style={{ lineHeight: 1.5 }}>Couldn't sign: {result.message ?? result.error}</span>
              </Mono>
            </div>
          )}
          {/* origin / trust */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', border: `1px solid ${req.recognized ? T.hair : T.warn}`, borderRadius: 14, background: T.card }}>
            <span style={{ width: 34, height: 34, flex: '0 0 auto', borderRadius: 10, border: `1px solid ${T.hairStrong}`, background: T.bg, color: T.inkSoft, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon.globe />
            </span>
            <div style={{ minWidth: 0, display: 'grid', gap: 2 }}>
              <span style={{ fontFamily: T.body, fontSize: 13.5, fontWeight: 500, color: T.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{req.origin}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon.lock style={{ width: 9, height: 9, color: req.recognized ? T.ok : T.warn }} />
                <Mono style={{ fontSize: 9.5, color: T.mute, letterSpacing: '0.04em' }}>{req.recognized ? 'https · connected' : 'https · first-time site'}</Mono>
              </span>
            </div>
            <span style={{ marginLeft: 'auto', flex: '0 0 auto' }}>
              <Tag tone={req.recognized ? 'ok' : 'accent'} small>{req.recognized ? 'recognized' : 'unrecognized'}</Tag>
            </span>
          </div>

          {/* simulated outcome — the hero */}
          <div style={{ border: `1px solid ${T.hair}`, borderRadius: 16, background: T.card, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 15px 9px', borderBottom: `1px solid ${T.hair}` }}>
              <Eyebrow>Estimated balance changes</Eyebrow>
              <Live label="simulated" color={T.accent} />
            </div>

            {outflows.map((d, i) => (
              <DeltaRow key={`o${i}`} d={d} caption="You send" />
            ))}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 15px' }}>
              <span style={{ flex: 1, height: 1, background: T.hair }} />
              <span style={{ width: 22, height: 22, borderRadius: 999, flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${T.hair}`, background: T.bg, color: T.mute, transform: 'rotate(90deg)' }}>
                <Icon.arrow style={{ width: 11, height: 11 }} />
              </span>
              <span style={{ flex: 1, height: 1, background: T.hair }} />
            </div>

            {inflows.map((d, i) => (
              <DeltaRow key={`i${i}`} d={d} caption="You receive" />
            ))}

            {req.rate && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 15px', background: T.bg, borderTop: `1px solid ${T.hair}` }}>
                <Mono style={{ fontSize: 10, color: T.mute }}>Rate</Mono>
                <Mono style={{ fontSize: 10.5, color: T.inkSoft }}><span className="cxw-tab">{req.rate}</span></Mono>
              </div>
            )}
          </div>

          {/* details */}
          <div style={{ border: `1px solid ${T.hair}`, borderRadius: 14, overflow: 'hidden' }}>
            {(
              [
                ['Interacting with', req.intent, req.counterparty ?? ''],
                ['Contract', req.contract.kind, req.contract.id],
                ['Network fee', `${req.fee.rateSatVb} sat/vB`, `${fmt(req.fee.btc, 'tBTC')} BTC · ${usd(req.fee.usd)}`],
                ['Network', 'Bitcoin', req.network],
              ] as [string, string, string][]
            ).map(([k, v, sub], i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '11px 15px', borderTop: i ? `1px solid ${T.hair}` : 'none', background: i % 2 ? T.bg : T.card }}>
                <Mono style={{ fontSize: 10.5, color: T.mute, letterSpacing: '0.03em' }}>{k}</Mono>
                <div style={{ textAlign: 'right', minWidth: 0 }}>
                  <div style={{ fontFamily: T.body, fontSize: 12.5, color: T.ink, fontWeight: 500 }}>{v}</div>
                  {sub && <Mono style={{ fontSize: 9.5, color: T.faint }}><span className="cxw-tab" style={{ wordBreak: 'break-all' }}>{sub}</span></Mono>}
                </div>
              </div>
            ))}
          </div>

          {/* advanced drawer */}
          <div style={{ border: `1px solid ${T.hair}`, borderRadius: 14, background: T.card, overflow: 'hidden' }}>
            <button className="cxw-btn" onClick={() => setAdv((v) => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 15px', border: 'none', background: 'transparent', textAlign: 'left' }}>
              <Eyebrow style={{ marginRight: 'auto' }}>Raw transaction</Eyebrow>
              <Mono style={{ fontSize: 9.5, color: T.faint }}>{req.inputs.length} in · {req.outputs.length} out</Mono>
              <span style={{ color: T.mute, transform: adv ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><Icon.chev /></span>
            </button>
            {adv && (
              <div className="cxw-in" style={{ padding: '0 15px 14px', display: 'grid', gap: 13 }}>
                {([['Inputs', req.inputs], ['Outputs', req.outputs]] as const).map(([title, rows]) => (
                  <div key={title}>
                    <Mono style={{ fontSize: 9.5, color: T.faint }}>
                      <span style={{ display: 'block', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>{title}</span>
                    </Mono>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {rows.map((r, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', border: `1px solid ${T.hair}`, borderRadius: 9, background: T.bg }}>
                          <div style={{ minWidth: 0, display: 'grid', gap: 1 }}>
                            <span style={{ fontFamily: T.body, fontSize: 11.5, color: T.ink, fontWeight: 500 }}>{r.label}</span>
                            <Mono style={{ fontSize: 9.5, color: T.faint }}>{r.detail}</Mono>
                          </div>
                          <Mono style={{ marginLeft: 'auto', fontSize: 10.5, color: T.inkSoft }}><span className="cxw-tab" style={{ whiteSpace: 'nowrap' }}>{r.amount}</span></Mono>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div>
                  <Mono style={{ fontSize: 9.5, color: T.faint }}>
                    <span style={{ display: 'block', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>PSBT + consignment</span>
                  </Mono>
                  <div style={{ border: `1px solid ${T.hair}`, borderRadius: 9, background: T.bg, padding: '9px 11px', maxHeight: 70, overflow: 'hidden' }}>
                    <Mono style={{ fontSize: 10, color: T.mute }}>
                      <span style={{ lineHeight: 1.55, wordBreak: 'break-all' }}>
                        {req.psbtBase64}
                        {req.consignment ? ` · ${req.consignment}` : ''}
                      </span>
                    </Mono>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* trust note */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '10px 13px', border: `1px dashed ${T.hairStrong}`, borderRadius: 12 }}>
            <span style={{ color: T.warn, flex: '0 0 auto', marginTop: 1 }}><Icon.alert /></span>
            <Mono style={{ fontSize: 10, color: T.mute }}>
              <span style={{ lineHeight: 1.55 }}>Only sign requests from sites you trust. Colorex signs locally — your keys and RGB state never leave this device.</span>
            </Mono>
          </div>
        </div>
      </div>

      {/* actions */}
      <div style={{ padding: '12px 16px 16px', borderTop: `1px solid ${T.hair}`, background: T.bg, display: 'flex', gap: 10 }}>
        <button className="cxw-btn" onClick={reject} style={{ flex: '0 0 auto', padding: '0 22px', height: 50, border: `1px solid ${T.hairStrong}`, borderRadius: 13, background: T.card, color: T.ink, fontFamily: T.body, fontSize: 14.5, fontWeight: 500 }}>Reject</button>
        <button className="cxw-btn" onClick={sign} style={{ flex: 1, height: 50, border: 'none', borderRadius: 13, background: T.accent, color: T.accentInk, fontFamily: T.body, fontSize: 15, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 10px 26px -12px rgba(184,90,44,0.7)' }}>
          <Icon.lock /> Sign
        </button>
      </div>
    </div>
  )
}

function DeltaRow({ d, caption }: { d: BalanceDelta; caption: string }) {
  const out = d.delta < 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px' }}>
      <AssetIcon sym={d.sym} isRgb={d.isRgb} size={36} />
      <div style={{ display: 'grid', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontFamily: T.body, fontSize: 13.5, fontWeight: 500, color: T.ink, whiteSpace: 'nowrap' }}>{d.sym}</span>
          {d.isRgb && <Tag tone="rgb" small>RGB</Tag>}
        </span>
        <Mono style={{ fontSize: 10, color: T.mute }}>{caption}</Mono>
      </div>
      <div style={{ flex: '0 0 auto', textAlign: 'right' }}>
        <div className="cxw-tab" style={{ fontFamily: T.body, fontSize: 16, fontWeight: 600, color: out ? T.ink : T.ok, letterSpacing: '-0.01em' }}>
          {out ? '−' : '+'}{fmt(Math.abs(d.delta), d.sym)}
        </div>
        <Mono style={{ fontSize: 10, color: T.faint }}><span className="cxw-tab">{usd(d.usd)}</span></Mono>
      </div>
    </div>
  )
}

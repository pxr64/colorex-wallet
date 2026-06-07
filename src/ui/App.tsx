import { type ReactNode, useEffect, useState } from 'react'
import { POPUP_H, POPUP_W, T } from './theme'
import { Lock } from './screens/Lock'
import { Onboarding } from './screens/Onboarding'
import { Home } from './screens/Home'
import { SignScreen } from './screens/SignScreen'
import { ConnectScreen } from './screens/ConnectScreen'
import { isUnlocked, lock as lockWallet, walletExists } from '../wallet/store'

type Route = 'lock' | 'onboarding' | 'home' | 'sign'

// Two roles:
//  • opened by the worker with `?id=<requestId>` → the signature approval window.
//  • opened normally → the wallet. The seed lives in memory only, so each open
//    starts locked (or at onboarding if no encrypted vault exists yet).
export function App() {
  const params = new URLSearchParams(window.location.search)
  const approvalId = params.get('id')
  const approvalKind = params.get('kind') // 'connect' for connection approvals
  const [route, setRoute] = useState<Route | null>(null)
  // The approval window is a fresh context — it must be unlocked here to sign
  // (the seed is never shared from the main popup).
  const [approvalUnlocked, setApprovalUnlocked] = useState(() => isUnlocked())

  useEffect(() => {
    void walletExists().then((exists) => setRoute(exists ? 'lock' : 'onboarding'))
  }, [])

  const go = (r: Route) => setRoute(r)
  const shell = (children: ReactNode) => (
    <div className="cxw" style={{ width: POPUP_W, height: POPUP_H, background: T.bg, color: T.ink, fontFamily: T.body, overflow: 'hidden' }}>
      {children}
    </div>
  )

  if (approvalId) {
    // Connect needs no seed — the address comes from the public descriptor and
    // approving only records the origin — so don't make the user unlock for it.
    // Signing does need the unlocked seed, so it stays gated.
    if (approvalKind === 'connect') {
      return shell(<ConnectScreen requestId={approvalId} />)
    }
    if (!approvalUnlocked) {
      return shell(<Lock onUnlock={() => setApprovalUnlocked(true)} onSetup={() => undefined} />)
    }
    return shell(<SignScreen requestId={approvalId} />)
  }

  let screen: ReactNode
  switch (route) {
    case null:
      screen = <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: T.faint, fontFamily: T.mono, fontSize: 12 }}>Loading…</div>
      break
    case 'lock':
      screen = <Lock onUnlock={() => go('home')} onSetup={() => go('onboarding')} />
      break
    case 'onboarding':
      screen = <Onboarding onDone={() => go('home')} onBack={() => go('lock')} />
      break
    case 'home':
      screen = (
        <Home
          onLock={() => {
            lockWallet()
            go('lock')
          }}
          onSign={() => go('sign')}
        />
      )
      break
    case 'sign':
      screen = <SignScreen requestId="mock" onClose={() => go('home')} />
      break
  }
  return shell(screen)
}

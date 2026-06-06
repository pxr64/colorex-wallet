import { T } from '../theme'
import { Logo } from '../atoms'

// Placeholder home. The read path (balances, activity, receive) lands in
// ROADMAP M4, driven by the WalletSdk (listAssets / getBtcBalance / blindReceive).
export function Home() {
  return (
    <main style={{ padding: 20, height: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Logo size={22} />
        <h1 style={{ fontSize: 16, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' }}>Colorex Wallet</h1>
      </div>
      <p style={{ color: T.mute, fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
        Scaffold. The wallet read path (balances, activity, receive) lands in
        ROADMAP&nbsp;M4. To preview the signature approval flow, open{' '}
        <code style={{ fontFamily: T.mono, color: T.accent }}>index.html?id=mock</code>.
      </p>
    </main>
  )
}

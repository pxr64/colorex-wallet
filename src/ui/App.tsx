import { POPUP_H, POPUP_W, T } from './theme'
import { Home } from './screens/Home'
import { SignScreen } from './screens/SignScreen'

// The popup is reused for both the wallet UI and the approval window. When the
// background worker opens it with `?id=<requestId>`, render the sign screen.
// The `.cxw` shell carries the design tokens (380×640, warm field, Geist).
export function App() {
  const id = new URLSearchParams(window.location.search).get('id')
  return (
    <div
      className="cxw"
      style={{
        width: POPUP_W,
        height: POPUP_H,
        background: T.bg,
        color: T.ink,
        fontFamily: T.body,
        overflow: 'hidden',
      }}
    >
      {id ? <SignScreen requestId={id} /> : <Home />}
    </div>
  )
}

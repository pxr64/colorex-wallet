// Clipboard hygiene (#1). Copying the recovery phrase — or an address — leaves it
// in the OS clipboard AND in clipboard-manager HISTORY, where any other app can
// read it later. We overwrite the clipboard a short while after a copy so the
// secret doesn't linger.
//
// BEST-EFFORT, by necessity:
//   • The popup is ephemeral — if it's dismissed before the timer fires, the timer
//     dies with it and the value remains. The TTL is the mechanism; there's no
//     reliable background clipboard access in MV3 to cover a forced close.
//   • We deliberately DON'T clear on visibilitychange/unmount: the common, intended
//     workflow is copy → switch to a password manager → paste, and clearing on blur
//     would wipe the value before the paste. The timer gives a paste window.
//   • We can't READ the clipboard (no `clipboardRead` permission — kept minimal),
//     so a clear unconditionally overwrites. Wiping a possibly-stale secret is the
//     safe trade; a fresh copy just resets the timer.

export const CLIPBOARD_TTL_MS = 30_000

let clearTimer: ReturnType<typeof setTimeout> | null = null

/** Copy `text`, then schedule a clipboard wipe after `ttlMs`. A subsequent copy
 *  resets the timer. Returns false if the platform refused the write. */
export async function copyAutoClear(text: string, ttlMs = CLIPBOARD_TTL_MS): Promise<boolean> {
  try {
    await navigator.clipboard?.writeText(text)
  } catch {
    return false
  }
  if (clearTimer) clearTimeout(clearTimer)
  clearTimer = setTimeout(() => void clearClipboard(), ttlMs)
  return true
}

/** Overwrite the clipboard now and cancel any pending auto-clear. */
export async function clearClipboard(): Promise<void> {
  if (clearTimer) {
    clearTimeout(clearTimer)
    clearTimer = null
  }
  try {
    await navigator.clipboard?.writeText('')
  } catch {
    /* best-effort */
  }
}

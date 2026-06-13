// Password strength — a lightweight, dependency-free estimator for the setup
// screen (#1: "8-char min is weak; add a strength meter / discourage weak
// passwords"). It is NOT a substitute for the KDF (vault.ts handles brute-force
// hardness); it's a UX guard that nudges users away from trivially-guessable
// passwords before their funds depend on them.
//
// Rough Shannon-style estimate: entropy ≈ length × log2(character-pool), with
// penalties for the cheap patterns a real attacker tries first (single character
// class, runs of repeats, obvious sequences). Deliberately conservative.

export interface PwStrength {
  /** 0 very weak · 1 weak · 2 fair · 3 strong · 4 very strong */
  score: 0 | 1 | 2 | 3 | 4
  label: string
  /** Whether it clears the bar to create a wallet (fair+ and ≥8 chars). */
  ok: boolean
  /** One actionable nudge when below "strong". */
  hint?: string
}

const LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const

function poolSize(pw: string): number {
  let pool = 0
  if (/[a-z]/.test(pw)) pool += 26
  if (/[A-Z]/.test(pw)) pool += 26
  if (/[0-9]/.test(pw)) pool += 10
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33 // printable ASCII symbols
  return pool
}

// Cheap, attacker-tried-first patterns that inflate the naive entropy estimate.
function hasWeakPattern(pw: string): boolean {
  const lower = pw.toLowerCase()
  if (/(.)\1{2,}/.test(pw)) return true // aaa, 111
  if (/^[a-z]+$/i.test(pw) || /^\d+$/.test(pw)) return true // single class
  const seqs = ['0123456789', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'password', 'colorex']
  return seqs.some((s) => s.includes(lower) || lower.includes(s.slice(0, Math.min(5, lower.length))) || s.startsWith(lower))
}

export function passwordStrength(pw: string): PwStrength {
  if (!pw) return { score: 0, label: LABELS[0], ok: false, hint: 'Enter a password.' }

  const bits = pw.length * Math.log2(poolSize(pw) || 1)
  let score: PwStrength['score']
  if (pw.length < 8 || bits < 28) score = 0
  else if (bits < 45) score = 1
  else if (bits < 60) score = 2
  else if (bits < 80) score = 3
  else score = 4

  // Demote anything matching a cheap pattern by one band (never below weak).
  if (score > 1 && hasWeakPattern(pw)) score = (score - 1) as PwStrength['score']

  const ok = pw.length >= 8 && score >= 2

  let hint: string | undefined
  if (pw.length < 8) hint = 'Use at least 8 characters.'
  else if (score < 3) hint = 'Mix upper/lowercase, numbers, and symbols — or add length.'

  return { score, label: LABELS[score], ok, hint }
}

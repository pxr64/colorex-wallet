#!/usr/bin/env node
// Supply-chain / anti-exfil guard (#1). A self-custodial wallet must never leak key
// material, and its network egress surface must stay small and known. This script
// is a TRIPWIRE, run in CI and locally (`pnpm check:supply-chain`): it fails the
// build if anything widens that surface — a new file making network calls, a
// hardcoded host that isn't allowlisted, the key/network layers getting entangled,
// a telemetry/analytics dependency creeping in, or the CSP gaining a remote source.
//
// It is heuristic, not a proof — it can't catch an exfil path laundered through an
// allowlisted file or an obfuscated host. Its job is to make the EASY regressions
// (an added `fetch`, a pasted analytics snippet, a loosened CSP) loud.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname

// --- policy -----------------------------------------------------------------------

// The ONLY files allowed to perform network I/O. A new egress site anywhere else
// fails the check until it's deliberately added here (with a justifying comment).
const EGRESS_ALLOWLIST = new Set([
  'src/wallet/esplora.ts', // Esplora: witness-tx confirmation status (chain reads)
  'src/colorex/client.ts', // Colorex broker (baseUrl injected at runtime, no literal host)
])

// Hosts a hardcoded URL literal may point at. The broker base URL is injected, so
// it isn't a literal and isn't listed here.
const HOST_ALLOWLIST = new Set(['mempool.space', 'app.colorex.io', 'localhost', '127.0.0.1'])

// Secret accessors / key material. None of these may be imported by an egress file
// (the network layer must be structurally separated from the keys).
const SECRET_SYMBOLS = [
  'signingKey',
  'unlockedSeed',
  'accountXprvFromMnemonic',
  'walletFromMnemonic',
  'decryptSeed',
  'encryptSeed',
  'mnemonicToSeed',
]

// Analytics/telemetry/session-replay package name fragments that must never appear
// in the dependency tree of a key-holding wallet.
const TELEMETRY_DENYLIST = [
  'analytics',
  'mixpanel',
  'segment',
  'amplitude',
  '@sentry',
  'posthog',
  'google-analytics',
  'gtag',
  'datadog',
  'bugsnag',
  'logrocket',
  'fullstory',
  'hotjar',
  'rudder',
  'heap-api',
]

// Network primitives. importScripts/EventSource/WebSocket/sendBeacon included so a
// future egress channel can't sneak past a fetch-only check.
const NET_PRIMITIVE = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(|\.sendBeacon\s*\(/
const REMOTE_IMPORT = /\bimport\s*\(\s*['"`]https?:/
const URL_LITERAL = /https?:\/\/([a-zA-Z0-9.\-]+)/g

// --- helpers ----------------------------------------------------------------------

const errors = []
const fail = (msg) => errors.push(msg)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(name)) out.push(p)
  }
  return out
}

const rel = (p) => p.slice(ROOT.length)

// --- 1. egress surface + host allowlist + key/network separation ------------------

const srcFiles = walk(join(ROOT, 'src'))
for (const file of srcFiles) {
  const r = rel(file)
  const text = readFileSync(file, 'utf8')

  const doesNet = NET_PRIMITIVE.test(text) || REMOTE_IMPORT.test(text)
  if (doesNet && !EGRESS_ALLOWLIST.has(r)) {
    fail(`network egress in non-allowlisted file: ${r} — add to EGRESS_ALLOWLIST (with justification) if intentional`)
  }
  if (REMOTE_IMPORT.test(text)) {
    fail(`remote dynamic import in ${r} — code must load only from the extension bundle`)
  }

  // Hardcoded URL hosts must be allowlisted (anywhere — not just egress files).
  for (const m of text.matchAll(URL_LITERAL)) {
    const host = m[1]
    if (host === 'www.w3.org' || host === 'schemas.colorex.io') continue // non-network identifiers
    if (!HOST_ALLOWLIST.has(host)) {
      fail(`non-allowlisted host literal "${host}" in ${r} — add to HOST_ALLOWLIST if intentional`)
    }
  }

  // An egress file must not also touch key material.
  if (EGRESS_ALLOWLIST.has(r)) {
    for (const sym of SECRET_SYMBOLS) {
      if (text.includes(sym)) {
        fail(`egress file ${r} references key-material symbol "${sym}" — keep the network and key layers separate`)
      }
    }
  }
}

// --- 2. telemetry / analytics dependencies ----------------------------------------

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }
for (const dep of Object.keys(allDeps)) {
  const hit = TELEMETRY_DENYLIST.find((bad) => dep.toLowerCase().includes(bad))
  if (hit) fail(`telemetry/analytics dependency "${dep}" (matches "${hit}") — a key-holding wallet must not ship one`)
}

// Lockfile-level scan catches a transitive telemetry dep too.
try {
  const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  for (const bad of TELEMETRY_DENYLIST) {
    // Match a package key like `  /@sentry/...` or `  mixpanel@...` to avoid false
    // hits on substrings inside integrity hashes.
    const re = new RegExp(`(^|/)${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[@/]`, 'm')
    if (re.test(lock)) fail(`telemetry/analytics package "${bad}" present in pnpm-lock.yaml (transitive?) — investigate`)
  }
} catch {
  /* no lockfile in this context — skip */
}

// --- 3. CSP must not allow remote/eval'd script -----------------------------------

const manifest = readFileSync(join(ROOT, 'src/manifest.ts'), 'utf8')
const csp = manifest.match(/script-src([^;"]*)/)
if (!csp) {
  fail("could not find a script-src in src/manifest.ts — CSP must pin script-src to 'self'")
} else {
  const value = csp[1]
  if (/https?:/.test(value)) fail(`CSP script-src allows a remote origin: "${value.trim()}"`)
  if (/'unsafe-inline'/.test(value)) fail(`CSP script-src allows 'unsafe-inline': "${value.trim()}"`)
  // 'wasm-unsafe-eval' is required for the RGB wasm; bare 'unsafe-eval' is not.
  if (/(^|\s)'unsafe-eval'/.test(value)) fail(`CSP script-src allows bare 'unsafe-eval': "${value.trim()}"`)
}

// --- report -----------------------------------------------------------------------

if (errors.length) {
  console.error(`\n✗ supply-chain check failed (${errors.length}):\n`)
  for (const e of errors) console.error('  • ' + e)
  console.error('')
  process.exit(1)
}
console.log('✓ supply-chain check passed — egress allowlisted, no telemetry, CSP locked, keys/network separated')

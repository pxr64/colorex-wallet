#!/usr/bin/env node
// Vendored-verifier drift guard (N6). rgb-wasm/src/spv/{merkle,proofpack,verify,headers,
// difficulty}.rs is a VERBATIM copy of the private backend's `rfq-consignment` crate (see
// rgb-wasm/src/spv/mod.rs). The trust-critical SPV verifier therefore lives in two repos; this
// TRIPWIRE (run in CI + locally, `pnpm check:vendor-sync`) fails the build if the copy drifts.
//
// Two modes:
//   • diff mode (RFQ_CONSIGNMENT_DIR set → the canonical crate's src dir): reconstruct the
//     canonical form from each vendored file (reverse the `crate::spv::`→`crate::` rewrite; for
//     difficulty.rs the upstream `#[cfg(test)]` block is stripped on vendoring) and DIFF it against
//     the real upstream file. This is the AUTHORITATIVE cross-repo check — run it when touching
//     either side, before committing a re-vendor.
//   • manifest mode (no env, e.g. CI without the private repo): hash the reconstructed form and
//     compare to scripts/vendor-manifest.json. This catches an accidental edit to the VENDORED
//     copy that wasn't mirrored upstream; it CANNOT see upstream-only drift (that's diff mode's job).
//
// After a deliberate re-vendor, regenerate the manifest in the SAME commit:
//   node scripts/check-vendor-sync.mjs --write-manifest

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const VENDORED_DIR = join(ROOT, 'rgb-wasm/src/spv')
const MANIFEST_PATH = join(ROOT, 'scripts/vendor-manifest.json')
const FILES = ['merkle', 'proofpack', 'verify', 'headers', 'difficulty']

// Reverse the only path rewrite applied on vendoring (mod.rs documents it).
const reconstruct = (vendored) => vendored.replaceAll('crate::spv::', 'crate::')

// difficulty.rs's trailing `#[cfg(test)]` block is stripped on vendoring (it differential-tests
// against the `bitcoin` dev-dep, which is upstream-only). Strip it from the canonical the same way
// (delete the `#[cfg(test)]` line and everything after, keeping the blank line before it) so the
// two compare equal.
const stripTests = (src) => {
  const i = src.indexOf('\n#[cfg(test)]')
  return i === -1 ? src : src.slice(0, i + 1)
}

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

const reconstructed = {}
for (const f of FILES) {
  reconstructed[f] = reconstruct(readFileSync(join(VENDORED_DIR, `${f}.rs`), 'utf8'))
}

if (process.argv.includes('--write-manifest')) {
  const manifest = {}
  for (const f of FILES) manifest[f] = sha(reconstructed[f])
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`✓ wrote ${MANIFEST_PATH} (${FILES.length} files)`)
  process.exit(0)
}

const errors = []
const fail = (m) => errors.push(m)

// mod.rs must still name all five vendored files in its "Keep in sync" list, so the list itself
// can't be silently trimmed and leave a file unguarded.
const modRs = readFileSync(join(VENDORED_DIR, 'mod.rs'), 'utf8')
for (const f of FILES) {
  if (!modRs.includes(f)) fail(`mod.rs no longer references "${f}" — keep the vendoring list complete`)
}

const canonDir = process.env.RFQ_CONSIGNMENT_DIR
if (canonDir) {
  // Authoritative cross-repo diff against the live canonical crate.
  for (const f of FILES) {
    const canonRaw = readFileSync(join(canonDir, `${f}.rs`), 'utf8')
    const canon = f === 'difficulty' ? stripTests(canonRaw) : canonRaw
    if (reconstructed[f] !== canon) {
      const a = reconstructed[f].split('\n')
      const b = canon.split('\n')
      let i = 0
      while (i < a.length && i < b.length && a[i] === b[i]) i++
      fail(
        `${f}.rs drifted from canonical at line ${i + 1}:\n` +
          `      vendored:  ${JSON.stringify(a[i])}\n` +
          `      canonical: ${JSON.stringify(b[i])}`,
      )
    }
  }
  if (!errors.length) console.log(`✓ vendored verifier matches canonical at ${canonDir}`)
} else {
  // Manifest tripwire (CI without the private repo).
  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'))
  } catch {
    fail(`missing/unreadable ${MANIFEST_PATH} — run \`node scripts/check-vendor-sync.mjs --write-manifest\` after vendoring`)
  }
  if (manifest) {
    for (const f of FILES) {
      const got = sha(reconstructed[f])
      if (got !== manifest[f]) {
        fail(
          `${f}.rs hash ${got.slice(0, 12)}… ≠ manifest ${String(manifest[f]).slice(0, 12)}… — the vendored ` +
            `copy was edited without updating the manifest (or it drifted from upstream). Run with ` +
            `RFQ_CONSIGNMENT_DIR=<rfq-consignment/src> for the authoritative diff.`,
        )
      }
    }
    if (!errors.length) {
      console.log('✓ vendored verifier matches scripts/vendor-manifest.json (set RFQ_CONSIGNMENT_DIR for the cross-repo diff)')
    }
  }
}

if (errors.length) {
  console.error(`\n✗ vendored-verifier drift check failed (${errors.length}):\n`)
  for (const e of errors) console.error('  • ' + e)
  console.error('\n  The SPV verifier is trust-critical and must stay identical across repos.')
  console.error('  Re-vendor from rfq-consignment, then `node scripts/check-vendor-sync.mjs --write-manifest`.\n')
  process.exit(1)
}

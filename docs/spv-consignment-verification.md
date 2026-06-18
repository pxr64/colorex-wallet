# SPV consignment verification — the wallet's trust model (for auditors)

Audience: security reviewers of the Colorex non-custodial wallet. This documents how the
wallet confirms that the RGB it is buying is **real and settled on Bitcoin** before it signs
away BTC — **without trusting the broker or any indexer**. See also
[`threat-model.md`](./threat-model.md).

## What the wallet must guarantee

A Colorex swap is an RFQ atomic swap where **the maker builds and broadcasts the PSBT**. The
wallet's job, before signing, is to be sure the maker's **consignment** (the RGB history) is
backed by Bitcoin transactions that are **actually mined** — not fabricated. RGB's own
validation does *not* guarantee this: an unmined or never-broadcast witness still validates as
`Valid`. So the wallet performs an independent **mined-ancestry** check.

## The non-negotiable: trust no server

> If the wallet believed the broker's (or an indexer's) word that "this is confirmed," it would
> just be custodial-by-proxy. The whole point is that the wallet verifies for itself.

**Not trusted:** the broker, any single esplora/indexer, the consignment's own claims, the SPV
proof producer.
**Trusted roots only:** Bitcoin **proof-of-work**, a small set of **checkpoints baked into the
wallet binary** (auditable constants), and the wallet binary itself.

## How verification runs (in the worker, in wasm)

The trust-critical logic runs in Rust/wasm (`rgb-wasm`), never in JS. JS only *fetches* data and
passes strings in — a lying source can only make verification **fail**, never falsely pass.

1. **Witness set** — `consignment_witness_ids(consignment)` extracts the witness txids the
   consignment depends on.
2. **Self-fetch from esplora** (no prover, no broker trusted): for each witness, its merkle proof
   (`/tx/:txid/merkle-proof`) + the relevant block headers (`/block/:hash/header`), and the chain
   tip. These assemble into an `SpvProofPack`.
3. **Verify locally** — `verify_consignment_spv(...)` (wasm) folds each witness's merkle proof and
   checks it against a block header the wallet **validated itself** (next section). Returns a
   verdict; the wallet refuses to sign on anything unmined/unverified.

Per witness, all five must hold: anchor present, header vouched by our own source, merkle proof
reproduces the header's root, ≥ K confirmations, and the ancestry is within the size cap.

## Why a fetched header can be trusted: the header ladder

The wallet gets headers from esplora but **does not believe them** — it validates them against
proof-of-work and a baked checkpoint (`CheckpointHeaderSource`):

- **Checkpoint anchor** — the run must start at a `(height, block_hash)` compiled into the wallet.
- **Linkage** — each header chains to the previous (`prev_block` = hash of prior header).
- **Proof-of-work** — `dsha256(header) ≤ target(bits)`.
- **Difficulty correctness** — see below; this is what makes PoW meaningful.

A malicious esplora would have to **redo real Bitcoin proof-of-work** from a checkpoint to forge
a chain that passes — economically impossible. esplora is reduced to a dumb delivery pipe.

(The ICP canister variant of this verifier uses ICP-native Bitcoin headers — already validated by
subnet consensus — so it needs no checkpoint or PoW logic at all.)

## Difficulty validation — closing the last hole

A header sets its *own* difficulty (`bits`), so "hash ≤ target" alone is forgeable for free
(claim minimum difficulty, mine on a laptop). The verifier therefore **recomputes** the required
difficulty from prior block timestamps (Bitcoin's 2016-block retarget rule) and rejects any header
whose `bits` disagree. Forging then costs real Bitcoin-scale work.

This consensus math is **differential-tested against rust-bitcoin** and against a **real mainnet
retarget** (block 840,672). rust-bitcoin is used *only* to test it upstream — it is **not** a
dependency of the wallet (the vendored verifier stays tiny: `sha2` + `serde`).

> **Network note:** PoW/difficulty validation is **mainnet-only**. Signet (the current deployment)
> secures blocks with a signer signature, not header PoW, so on signet the SPV path is not fully
> trustless — acceptable for a test network. The verifier is mainnet-ready; the live deployment
> stays on signet pending review.

## Scaling: dense checkpoints + bounded runs

Rather than syncing the whole header chain, the wallet bakes **one checkpoint per difficulty epoch**
(every 2016 blocks; ~440 hashes ≈ 14 KB cover all of Bitcoin history). To verify a witness at
height `W`, it fetches only the short run from the **nearest checkpoint at/below `W`** up to `W` —
**≤ 2016 headers**, regardless of chain height or how long the wallet was offline. Per-witness runs
are validated independently and merged (`from_segments`). A verified-witness cache (planned) drops
repeat-trade cost to ~O(new witnesses).

## Where the code is

- **Vendored verifier** (pure, no chain access): `rgb-wasm/src/spv/{merkle,proofpack,verify,headers,difficulty}.rs`
  — a verbatim copy of the backend `rfq-consignment` crate (this repo is public and must not depend
  on the private backend; see `rgb-wasm/src/spv/mod.rs` for the keep-in-sync contract).
- **Wasm bindings:** `verify_consignment_spv` / `spv_recommended_confs` / `consignment_witness_ids`
  in `rgb-wasm/src/lib.rs`.
- **esplora fetch primitives:** `src/wallet/esplora.ts` (`txMerkleProof`, `blockHeader`,
  `blockHashAtHeight`, `tipHeight`).

## Residual trust & limitations

- Standard SPV assumptions (header source = most-work chain; no reorg deeper than K).
- Baked checkpoints must be refreshed as epochs accrue; a stale table fails closed.
- Signet is not fully trustless (PoW gating is mainnet-only).
- RGB itself is pre-release (`rgb-api`/`bp-*` rc/alpha) — protocol risk outside this verifier.
- The vendored verifier must stay in sync with the backend `rfq-consignment` crate.

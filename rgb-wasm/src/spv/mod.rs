//! Vendored SPV consignment verifier.
//!
//! These modules are a **verbatim copy** of the pure verifier core from the (private)
//! exchange backend's `rfq-consignment` crate — `merkle`, `proofpack`, `verify`, `headers`.
//! This repo is public and must not take a live dependency on the private repo
//! (see CLAUDE.md "Public repo — guardrails"), so the trust-critical verifier is vendored
//! instead of imported. It is generic SPV/merkle code with no exchange internals.
//!
//! **Keep in sync** with `rgb-rfq/crates/rfq-consignment/src/{merkle,proofpack,verify,headers}.rs`.
//! The only edit applied on vendoring is the module path rewrite
//! `crate::{merkle,proofpack,verify}::` → `crate::spv::$1::` (these live under `spv` here).
//!
//! Pure: depends only on `sha2` + `serde` — no electrum, no chain access. The JS host
//! supplies merkle proofs + headers (self-fetched from esplora); a lying source can only
//! cause a verification *failure*, never a false accept.

// The vendored copy is verbatim; it carries helpers + a full re-export surface the wallet
// binding doesn't all use (e.g. `to_json`, `tip_height`, `SpvVerdict`). Allow dead code +
// unused imports so the copy stays diff-clean against the upstream source instead of being
// trimmed (which would cause drift).
#![allow(dead_code, unused_imports)]

pub mod headers;
pub mod merkle;
pub mod proofpack;
pub mod verify;

pub use headers::{Checkpoint, CheckpointHeaderSource, Network};
pub use proofpack::{SpvProofPack, WitnessInclusion};
pub use verify::{verify_pack, HeaderInfo, HeaderSource, RejectReason, SpvVerdict};

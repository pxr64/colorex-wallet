//! WASM boundary over the RGB protocol core (`rgb-api`) for the Colorex wallet.
//!
//! This is the spine the browser `WalletSdk` hangs off of: the RGB engine runs
//! in the extension's service worker via this module, while keys/PSBT (bdk-wasm),
//! storage (IndexedDB), and the indexer/transport (`fetch`) live in JS/TS.
//!
//! The persistence model: the RGB `Stock` lives in wasm memory on the in-memory
//! providers; durability is JS's job — wasm hands the strict-serialized provider
//! bytes to JS, which stores/loads them in IndexedDB (mirroring how `FsBinStore`
//! reads/writes those same providers as files natively).

use std::str::FromStr;

use rgb::containers::{FileContent, Kit};
use rgb::persistence::{MemIndex, MemStash, MemState, Stock};
use strict_encoding::{StrictDeserialize, StrictSerialize};
use wasm_bindgen::prelude::*;

// Network-agnostic NIA (Non-Inflatable Asset) schema kit — same artifact the
// exchange backend embeds.
const NIA_SCHEMA_KIT: &[u8] = include_bytes!("../schemas/NonInflatableAsset.rgb");

// Strict-encoding size bound (u32::MAX), matching the native FsBinStore.
const MAX: usize = u32::MAX as usize;

/// Library version marker — a trivial call to confirm the module loaded.
#[wasm_bindgen]
pub fn version() -> String {
    format!("rgb-wasm {} (rgb-api 0.11.1-rc.6)", env!("CARGO_PKG_VERSION"))
}

/// Validate an RGB contract id (`rgb:…`). Proves the RGB engine is live in wasm.
#[wasm_bindgen]
pub fn is_valid_contract_id(id: &str) -> bool {
    rgb::ContractId::from_str(id).is_ok()
}

/// Parse an RGB invoice and return its normalized (round-tripped) string. Proves
/// the RGB invoice parser runs in wasm — a real wallet operation. Errors on
/// malformed input.
#[wasm_bindgen]
pub fn parse_invoice(invoice: &str) -> Result<String, JsError> {
    let parsed = rgb::invoice::RgbInvoice::from_str(invoice)
        .map_err(|e| JsError::new(&format!("invalid RGB invoice: {e:?}")))?;
    Ok(parsed.to_string())
}

/// THE persistence proof: build a fresh in-memory `Stock`, import the NIA schema
/// (a real stateful mutation), strict-serialize the three providers to bytes
/// (what would go to IndexedDB), reconstruct a `Stock` from those bytes, and
/// re-query — confirming stateful RGB survives a serialize → deserialize round
/// trip in wasm. Returns a human-readable summary.
#[wasm_bindgen]
pub fn demo_stock_persistence() -> Result<String, JsError> {
    // 1. fresh stock + import the NIA schema.
    let mut stock = Stock::in_memory();
    let kit = Kit::load(&mut &NIA_SCHEMA_KIT[..])
        .map_err(|e| JsError::new(&format!("load kit: {e}")))?
        .validate()
        .map_err(|e| JsError::new(&format!("validate kit: {e:?}")))?;
    stock
        .import_kit(kit)
        .map_err(|e| JsError::new(&format!("import kit: {e}")))?;
    let before = stock
        .schemata()
        .map_err(|e| JsError::new(&format!("schemata: {e}")))?
        .count();

    // 2. serialize the three providers to bytes (→ IndexedDB, in production).
    let stash_b = stock
        .as_stash_provider()
        .to_strict_serialized::<MAX>()
        .map_err(|e| JsError::new(&format!("ser stash: {e}")))?;
    let state_b = stock
        .as_state_provider()
        .to_strict_serialized::<MAX>()
        .map_err(|e| JsError::new(&format!("ser state: {e}")))?;
    let index_b = stock
        .as_index_provider()
        .to_strict_serialized::<MAX>()
        .map_err(|e| JsError::new(&format!("ser index: {e}")))?;

    // 3. reconstruct from those bytes (← IndexedDB, in production) and re-query.
    let stash = MemStash::from_strict_serialized::<MAX>(stash_b.clone())
        .map_err(|e| JsError::new(&format!("de stash: {e}")))?;
    let state = MemState::from_strict_serialized::<MAX>(state_b.clone())
        .map_err(|e| JsError::new(&format!("de state: {e}")))?;
    let index = MemIndex::from_strict_serialized::<MAX>(index_b.clone())
        .map_err(|e| JsError::new(&format!("de index: {e}")))?;
    let reloaded = Stock::with(stash, state, index);
    let after = reloaded
        .schemata()
        .map_err(|e| JsError::new(&format!("schemata (reloaded): {e}")))?
        .count();

    Ok(format!(
        "schemata before={before}, after_reload={after}; serialized bytes stash={} state={} index={}",
        stash_b.len(),
        state_b.len(),
        index_b.len()
    ))
}

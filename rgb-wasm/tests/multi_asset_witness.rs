//! Multi-asset witness handling for the import queue's engine: accepting a second
//! asset must NOT archive the first, and a dropped witness MUST revert just its own
//! allocation. These guard the `full_resolver` fix in `accept_consignment` +
//! `update_witnesses` (a resolver scoped to one consignment would resolve every
//! OTHER asset's witness as Unresolved → Archived, silently dropping it).
//!
//! Runs as a plain `cargo test` — `RgbStock` is callable on host (the cdylib also
//! builds an rlib; the `getrandom` js feature is a no-op off wasm). The engine logic
//! is identical to what runs in the extension worker.
//!
//! ## Fixtures (required to actually run the multi-asset case)
//!
//! Two real consignments for two DISTINCT contracts, base64, at:
//!   - `tests/fixtures/asset_a.consignment`
//!   - `tests/fixtures/asset_b.consignment`
//!   - `tests/fixtures/network` (optional; the network the consignments anchor to —
//!     defaults to `regtest`). Must match how they were issued.
//!
//! A witness-anchored transfer needs funded UTXOs, so these can't be fabricated
//! in-process — generate them once from the regtest harness:
//!   1. `colorex issuer issue --ticker AAA …` and `… --ticker BBB …` (two contracts).
//!   2. Run a buy of each to a taker (or `distribute` to a taker invoice); capture
//!      the `final_consignment` (base64) each emits — that's the fixture.
//!   3. Drop the two blobs at the paths above.
//! Without the fixtures the multi-asset test SKIPS (it does not fail).

use std::fs;
use std::path::PathBuf;

use rgb_wasm::RgbStock;
use serde_json::Value;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn read_b64(name: &str) -> Option<Vec<u8>> {
    let raw = fs::read_to_string(fixtures_dir().join(name)).ok()?;
    let cleaned: String = raw.split_whitespace().collect();
    use base64::Engine as _;
    Some(
        base64::engine::general_purpose::STANDARD
            .decode(cleaned.as_bytes())
            .expect("fixture is valid base64"),
    )
}

fn network() -> String {
    fs::read_to_string(fixtures_dir().join("network"))
        .map(|s| s.trim().to_owned())
        .unwrap_or_else(|_| "regtest".to_owned())
}

fn witness_ids(stock: &RgbStock, consignment: &[u8]) -> Vec<String> {
    serde_json::from_str(&stock.consignment_witness_ids(consignment).expect("witness ids"))
        .expect("witness ids json")
}

/// `[{ "txid": … }]` — height-less, so each witness is accepted as Tentative.
fn tentative_ords(txids: &[String]) -> String {
    Value::Array(txids.iter().map(|t| serde_json::json!({ "txid": t })).collect()).to_string()
}

/// `[{ "txid": …, "archived": true }]` — marks each witness dropped/replaced.
fn archived_ords(txids: &[String]) -> String {
    Value::Array(
        txids
            .iter()
            .map(|t| serde_json::json!({ "txid": t, "archived": true }))
            .collect(),
    )
    .to_string()
}

/// `[{ "txid": …, "height": h, "time": t }]` — promotes each witness to Mined.
fn mined_ords(txids: &[String]) -> String {
    Value::Array(
        txids
            .iter()
            .map(|t| serde_json::json!({ "txid": t, "height": 100, "time": 1_700_000_000i64 }))
            .collect(),
    )
    .to_string()
}

/// Parse `list_assets()` → (contract_id, balance) pairs.
fn assets(stock: &RgbStock) -> Vec<(String, u64)> {
    let json: Vec<Value> = serde_json::from_str(&stock.list_assets().expect("list_assets")).unwrap();
    json.into_iter()
        .map(|a| {
            (
                a["contractId"].as_str().unwrap().to_owned(),
                a["balance"].as_u64().unwrap(),
            )
        })
        .collect()
}

/// `contract_id`'s balance restricted to allocations sitting on `witness_txids`'
/// outputs — i.e. what a recipient who received via those witnesses actually holds.
/// This (not the unfiltered total, which is the conserved contract supply: archiving
/// a transfer witness just reverts the allocation to the spent genesis) is what moves
/// when a witness is archived, and what the wallet's `list_assets_owned` measures.
fn owned_balance(stock: &RgbStock, witness_txids: &[String], contract_id: &str) -> u64 {
    let owned: Vec<String> = witness_txids
        .iter()
        .flat_map(|t| (0..6u32).map(move |vout| format!("{t}:{vout}")))
        .collect();
    let json: Vec<Value> =
        serde_json::from_str(&stock.list_assets_owned(&serde_json::to_string(&owned).unwrap()).unwrap()).unwrap();
    json.into_iter()
        .find(|a| a["contractId"].as_str() == Some(contract_id))
        .and_then(|a| a["balance"].as_u64())
        .unwrap_or(0)
}

/// Sanity: the engine is reachable on host and a fresh stock is empty.
#[test]
fn fresh_stock_is_empty() {
    let stock = RgbStock::new().expect("new stock");
    assert_eq!(stock.list_assets().expect("list_assets"), "[]");
}

/// The core guarantees, end to end on a single stock:
///   1. accept A (tentative)               → A has a positive balance.
///   2. accept B (tentative)               → A's balance SURVIVES (regression guard
///                                            for the multi-asset archiving bug) and
///                                            B has a positive balance.
///   3. archive A's witness (revert)       → A → 0, B unchanged.
///   4. re-mine A's witness (promote)      → A's balance returns.
#[test]
fn second_accept_preserves_first_and_revert_is_isolated() {
    let (a, b) = match (read_b64("asset_a.consignment"), read_b64("asset_b.consignment")) {
        (Some(a), Some(b)) => (a, b),
        _ => {
            eprintln!(
                "SKIP second_accept_preserves_first_and_revert_is_isolated: \
                 fixtures absent — see this file's header to generate them"
            );
            return;
        }
    };
    let net = network();
    let mut stock = RgbStock::new().expect("new stock");

    // 1. Accept A (Tentative). One asset; A holds a positive balance on its witness.
    let a_txids = witness_ids(&stock, &a);
    stock
        .accept_consignment(&a, &tentative_ords(&a_txids), &net)
        .expect("accept A");
    let after_a = assets(&stock);
    assert_eq!(after_a.len(), 1, "exactly one asset after accepting A");
    let a_cid = after_a.into_iter().next().unwrap().0;
    let a_balance = owned_balance(&stock, &a_txids, &a_cid);
    assert!(a_balance > 0, "A holds a positive balance on its witness");

    // 2. Accept B (Tentative). THE REGRESSION GUARD: A's allocation on its own witness
    // must SURVIVE — the old consignment-scoped resolver archived A's witness here
    // (→ A would drop to 0). B lands on its own witness.
    let b_txids = witness_ids(&stock, &b);
    stock
        .accept_consignment(&b, &tentative_ords(&b_txids), &net)
        .expect("accept B");
    assert_eq!(
        owned_balance(&stock, &a_txids, &a_cid),
        a_balance,
        "accepting B must NOT archive A's allocation (multi-asset regression)"
    );
    let b_cid = assets(&stock)
        .into_iter()
        .map(|(cid, _)| cid)
        .find(|cid| cid != &a_cid)
        .expect("B's contract present");
    let b_balance = owned_balance(&stock, &b_txids, &b_cid);
    assert!(b_balance > 0, "B holds a positive balance on its witness");

    // 3. Revert A: archive its witness(es). A's allocation drops off its witness; B
    // is untouched.
    stock
        .update_witnesses(&archived_ords(&a_txids), &net)
        .expect("archive A witness");
    assert_eq!(owned_balance(&stock, &a_txids, &a_cid), 0, "A reverts to 0 once its witness is archived");
    assert_eq!(owned_balance(&stock, &b_txids, &b_cid), b_balance, "B is unaffected by A's revert");

    // 4. Promote A back: re-resolve its witness as Mined. Allocation returns.
    stock
        .update_witnesses(&mined_ords(&a_txids), &net)
        .expect("re-mine A witness");
    assert_eq!(owned_balance(&stock, &a_txids, &a_cid), a_balance, "A returns once its witness is mined again");
}

/// `consignment_delivery_to_me` reads the RGB a maker consignment delivers to the
/// wallet's OWN seals WITHOUT mutating the live stock (gap A2: validate-without-absorb),
/// and yields 0 for a seal we don't own — the structural half of the #38 delivered-value
/// gate (a maker can't make us see inflow that isn't actually ours).
#[test]
fn delivery_to_my_seals_reads_amount_and_rejects_wrong_seal() {
    let a = match read_b64("asset_a.consignment") {
        Some(a) => a,
        None => {
            eprintln!("SKIP delivery_to_my_seals_reads_amount_and_rejects_wrong_seal: fixtures absent");
            return;
        }
    };
    let net = network();
    let stock = RgbStock::new().expect("new stock");
    let a_txids = witness_ids(&stock, &a);

    // The consignment delivers to witness-vout seals on its witness tx(s): "<txid>:<vout>",
    // the same outpoint set `owned_balance` reads. This is what the wallet sources from
    // `decode_psbt` (its k10-tagged output on the swap tx) in production.
    let my_seals: Vec<String> = a_txids
        .iter()
        .flat_map(|t| (0..6u32).map(move |v| format!("{t}:{v}")))
        .collect();
    let res = stock
        .consignment_delivery_to_me(&a, &net, &serde_json::to_string(&my_seals).unwrap())
        .expect("delivery read");
    let v: Value = serde_json::from_str(&res).unwrap();
    let amount = v["amount"].as_u64().expect("amount");
    assert!(amount > 0, "delivers a positive amount to our witness-vout seal");

    // Cross-check amount + contract against the live-accept balance path (same number,
    // derived without absorbing).
    let mut s2 = RgbStock::new().expect("new stock");
    s2.accept_consignment(&a, &tentative_ords(&a_txids), &net).expect("accept A");
    let a_cid = assets(&s2).into_iter().next().unwrap().0;
    assert_eq!(v["contractId"].as_str().unwrap(), a_cid, "same contract id");
    assert_eq!(amount, owned_balance(&s2, &a_txids, &a_cid), "delivered == accept-path balance");

    // Wrong seal → 0: RGB delivered to a seal we don't own contributes nothing.
    let bogus = serde_json::to_string(&[format!("{}:0", "00".repeat(32))]).unwrap();
    let res0 = stock
        .consignment_delivery_to_me(&a, &net, &bogus)
        .expect("delivery read (wrong seal)");
    let v0: Value = serde_json::from_str(&res0).unwrap();
    assert_eq!(v0["amount"].as_u64().unwrap(), 0, "RGB to a seal we don't own contributes 0");

    // Validate-without-absorb (A2): neither read mutated the LIVE stock.
    assert_eq!(stock.list_assets().expect("list_assets"), "[]", "scratch reads leave the live stock empty");
}

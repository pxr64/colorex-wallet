//! WASM boundary over the RGB protocol core (`rgb-api`) for the Colorex wallet.
//!
//! This is the spine the browser `WalletSdk` hangs off of: the RGB engine runs
//! in the extension's service worker via this module, while keys/PSBT (bdk-wasm),
//! storage (IndexedDB), and the indexer/transport (`fetch`) live in JS/TS.
//!
//! Persistence model: the RGB `Stock` lives in wasm memory on the in-memory
//! providers (`MemStash`/`MemState`/`MemIndex`); durability is JS's job. `save()`
//! hands the strict-serialized provider bytes to JS to store in IndexedDB;
//! `load(...)` rebuilds the `Stock` from those bytes — mirroring how `FsBinStore`
//! reads/writes the same providers as files natively.

use std::collections::{HashMap, HashSet};
use std::num::NonZeroU32;
use std::str::FromStr;

use amplify::confinement::Confined;
use bpstd::psbt::Psbt;
use bpstd::{Address, Keychain, Network, ScriptPubkey, Txid, XpubDerivable};
use bpwallet::Wallet;
use rgb::containers::{ConsignmentExt, FileContent, Kit, Transfer, ValidConsignment};
use rgb::contract::FilterIncludeAll;
use rgb::invoice::{Beneficiary, Pay2Vout, RgbInvoiceBuilder, XChainNet};
use rgb::persistence::{MemIndex, MemStash, MemState, StashReadProvider, Stock};
use rgb::stl::AssetSpec;
use rgb::validation::{
    ResolveWitness, ValidationConfig, Validity, WitnessResolverError, WitnessStatus,
};
use rgb::vm::{WitnessOrd, WitnessPos};
use rgb::{ChainNet, ContractId, RgbDescr, RgbKeychain, StateType, TapretKey};
use strict_encoding::{StrictDeserialize, StrictSerialize};
use wasm_bindgen::prelude::*;

// Network-agnostic NIA (Non-Inflatable Asset) schema kit — same artifact the
// exchange backend embeds.
const NIA_SCHEMA_KIT: &[u8] = include_bytes!("../schemas/NonInflatableAsset.rgb");

// Strict-encoding size bound (u32::MAX), matching the native FsBinStore.
const MAX: usize = u32::MAX as usize;

type WalletStock = Stock<MemStash, MemState, MemIndex>;

fn import_nia(stock: &mut WalletStock) -> Result<(), JsError> {
    let kit = Kit::load(&mut &NIA_SCHEMA_KIT[..])
        .map_err(|e| JsError::new(&format!("load NIA kit: {e}")))?
        .validate()
        .map_err(|e| JsError::new(&format!("validate NIA kit: {e:?}")))?;
    stock
        .import_kit(kit)
        .map_err(|e| JsError::new(&format!("import NIA kit: {e}")))?;
    Ok(())
}

fn ser<T: StrictSerialize>(provider: &T) -> Result<Vec<u8>, JsError> {
    Ok(provider
        .to_strict_serialized::<MAX>()
        .map_err(|e| JsError::new(&format!("serialize: {e}")))?
        .release())
}

fn de<T: StrictDeserialize>(bytes: &[u8]) -> Result<T, JsError> {
    let confined = Confined::<Vec<u8>, 0, MAX>::try_from(bytes.to_vec())
        .map_err(|e| JsError::new(&format!("confine: {e}")))?;
    T::from_strict_serialized::<MAX>(confined).map_err(|e| JsError::new(&format!("deserialize: {e}")))
}

// ---------------------------------------------------------------------------
// Stateless helpers (smoke tests / pure ops)
// ---------------------------------------------------------------------------

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

/// Parse an RGB invoice and return its normalized (round-tripped) string.
#[wasm_bindgen]
pub fn parse_invoice(invoice: &str) -> Result<String, JsError> {
    let parsed = rgb::invoice::RgbInvoice::from_str(invoice)
        .map_err(|e| JsError::new(&format!("invalid RGB invoice: {e:?}")))?;
    Ok(parsed.to_string())
}

/// Prove the bitcoin wallet runs in wasm: from a BIP-86 tapret descriptor
/// (`<xpub>/<0;1;10>/*`, derived in JS via @scure/bip39+bip32), build an
/// in-memory `bp-wallet` and derive a fresh keychain-10 (Tapret) receive address
/// — the beneficiary a witness-vout `create_invoice` binds to. Key *generation*
/// stays in JS (bp-wallet's `hot` key store pulls aws-lc, which isn't wasm-able);
/// wasm does wallet construction, derivation, and (later) signing.
#[wasm_bindgen]
pub fn derive_keychain10_address(descriptor: &str, network: &str) -> Result<String, JsError> {
    let xpub = XpubDerivable::from_str(descriptor)
        .map_err(|e| JsError::new(&format!("parse descriptor: {e}")))?;
    let rgb_descr: RgbDescr = TapretKey::from(xpub).into();
    let mut wallet: Wallet<XpubDerivable, RgbDescr> = Wallet::new_layer1(rgb_descr, btc_network(network)?);
    let addr = wallet.next_address(RgbKeychain::Tapret, false);
    Ok(addr.to_string())
}

/// Derive the first `count` addresses of a keychain (0 = receive, 1 = change,
/// 10 = tapret RGB anchors), as a JSON array. The caller scans these on Esplora
/// to learn which UTXOs (hence which RGB allocations) the wallet owns.
#[wasm_bindgen]
pub fn derive_addresses(descriptor: &str, network: &str, keychain: u8, count: u32) -> Result<String, JsError> {
    let xpub = XpubDerivable::from_str(descriptor)
        .map_err(|e| JsError::new(&format!("parse descriptor: {e}")))?;
    let rgb_descr: RgbDescr = TapretKey::from(xpub).into();
    let wallet: Wallet<XpubDerivable, RgbDescr> = Wallet::new_layer1(rgb_descr, btc_network(network)?);
    let addrs: Vec<String> = wallet
        .addresses(Keychain::from(keychain))
        .take(count as usize)
        .map(|d| d.addr.to_string())
        .collect();
    Ok(serde_json::Value::Array(addrs.into_iter().map(serde_json::Value::String).collect()).to_string())
}

/// Decode a maker's partial PSBT into the wallet's BITCOIN side: which inputs and
/// outputs are ours (by owned outpoint / owned address), the net BTC delta, and
/// the fee. This is the security core of a sign request — it verifies the bitcoin
/// the wallet pays, independent of anything the dApp claims. The RGB delta comes
/// from the quote/invoice (what the wallet asked for), validated later on accept.
/// `owned_outpoints` = `["txid:vout", …]` (our UTXOs); `owned_addresses` = our
/// derived address strings (to spot our change/receive outputs).
#[wasm_bindgen]
pub fn decode_psbt(
    psbt_bytes: &[u8],
    owned_outpoints_json: &str,
    owned_addresses_json: &str,
) -> Result<String, JsError> {
    let psbt = Psbt::deserialize(psbt_bytes).map_err(|e| JsError::new(&format!("parse psbt: {e}")))?;
    let owned_ops: HashSet<String> = serde_json::from_str(owned_outpoints_json)
        .map_err(|e| JsError::new(&format!("parse outpoints: {e}")))?;

    // Owned addresses tagged with their derivation: `[{ address, keychain, index }]`.
    // The derivation is what lets the signer sign the right input with the right
    // key — a generic signer can't auto-detect this when the maker's PSBT carries
    // no bip32/tap derivation on our inputs.
    let owned_val: serde_json::Value = serde_json::from_str(owned_addresses_json)
        .map_err(|e| JsError::new(&format!("parse addresses: {e}")))?;
    let mut owned_spks: Vec<(ScriptPubkey, u32, u32)> = Vec::new();
    if let Some(arr) = owned_val.as_array() {
        for e in arr {
            let Some(a) = e.get("address").and_then(|v| v.as_str()) else { continue };
            let kc = e.get("keychain").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            let idx = e.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as u32;
            if let Ok(ad) = Address::from_str(a) {
                owned_spks.push((ad.script_pubkey(), kc, idx));
            }
        }
    }

    let mut inputs = Vec::new();
    let mut sign_inputs = Vec::new();
    let mut total_in: u64 = 0;
    let mut in_ours: u64 = 0;
    for (pos, inp) in psbt.inputs().enumerate() {
        let op = inp.previous_outpoint.to_string();
        let val = inp.value().sats();
        let spk = inp.prev_txout().script_pubkey.clone();
        // Match by the input's prev scriptPubkey → the address's derivation.
        let deriv = owned_spks.iter().find(|(s, _, _)| *s == spk).map(|(_, kc, idx)| (*kc, *idx));
        let ours = owned_ops.contains(&op) || deriv.is_some();
        total_in = total_in.saturating_add(val);
        if ours {
            in_ours = in_ours.saturating_add(val);
        }
        let mut entry = serde_json::json!({ "outpoint": op, "valueSats": val, "ours": ours });
        if let Some((kc, idx)) = deriv {
            entry["keychain"] = serde_json::json!(kc);
            entry["index"] = serde_json::json!(idx);
            // Explicit instruction for the signer: sign THIS input index with the
            // key at (keychain, addrIndex). No reliance on PSBT-embedded derivation.
            sign_inputs.push(serde_json::json!({ "index": pos, "keychain": kc, "addrIndex": idx }));
        }
        inputs.push(entry);
    }

    let mut outputs = Vec::new();
    let mut total_out: u64 = 0;
    let mut out_ours: u64 = 0;
    for out in psbt.outputs() {
        let val = out.amount.sats();
        let ours = owned_spks.iter().any(|(s, _, _)| *s == out.script);
        total_out = total_out.saturating_add(val);
        if ours {
            out_ours = out_ours.saturating_add(val);
        }
        outputs.push(serde_json::json!({ "valueSats": val, "ours": ours }));
    }

    let fee = total_in.saturating_sub(total_out);
    let btc_delta = out_ours as i64 - in_ours as i64;
    Ok(serde_json::json!({
        "feeSats": fee,
        "btcInOursSats": in_ours,
        "btcOutOursSats": out_ours,
        "btcDeltaSats": btc_delta,
        "totalInSats": total_in,
        "totalOutSats": total_out,
        "inputs": inputs,
        "outputs": outputs,
        "signInputs": sign_inputs,
    })
    .to_string())
}

// ---------------------------------------------------------------------------
// The persistence spine: a Stock handle JS owns, with bytes in/out
// ---------------------------------------------------------------------------

/// The three serialized provider blobs to persist to IndexedDB.
#[wasm_bindgen]
pub struct StockSnapshot {
    stash: Vec<u8>,
    state: Vec<u8>,
    index: Vec<u8>,
}

#[wasm_bindgen]
impl StockSnapshot {
    #[wasm_bindgen(getter)]
    pub fn stash(&self) -> Vec<u8> {
        self.stash.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> Vec<u8> {
        self.state.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn index(&self) -> Vec<u8> {
        self.index.clone()
    }
}

/// An RGB `Stock` owned by JS. JS holds one of these per wallet, calls `save()`
/// after mutations to persist to IndexedDB, and `load()` on startup.
#[wasm_bindgen]
pub struct RgbStock {
    stock: WalletStock,
}

#[wasm_bindgen]
impl RgbStock {
    /// Fresh wallet stock with the NIA schema imported — first-run.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Result<RgbStock, JsError> {
        let mut stock = Stock::in_memory();
        import_nia(&mut stock)?;
        Ok(RgbStock { stock })
    }

    /// Restore a stock from previously-saved IndexedDB bytes (the three blobs
    /// from [`RgbStock::save`]).
    pub fn load(stash: &[u8], state: &[u8], index: &[u8]) -> Result<RgbStock, JsError> {
        let stock = Stock::with(de(stash)?, de(state)?, de(index)?);
        Ok(RgbStock { stock })
    }

    /// Serialize the stock for persistence to IndexedDB.
    pub fn save(&self) -> Result<StockSnapshot, JsError> {
        Ok(StockSnapshot {
            stash: ser(self.stock.as_stash_provider())?,
            state: ser(self.stock.as_state_provider())?,
            index: ser(self.stock.as_index_provider())?,
        })
    }

    /// Number of schemata known (≥1 after `new()`). A read op to verify state.
    pub fn schema_count(&self) -> Result<u32, JsError> {
        Ok(self
            .stock
            .schemata()
            .map_err(|e| JsError::new(&format!("schemata: {e}")))?
            .count() as u32)
    }

    /// Number of contracts (assets) the stock tracks.
    pub fn contract_count(&self) -> Result<u32, JsError> {
        Ok(self
            .stock
            .contracts()
            .map_err(|e| JsError::new(&format!("contracts: {e}")))?
            .count() as u32)
    }

    /// Every asset the stock holds, as JSON: `[{ contractId, ticker, precision,
    /// balance }]`. Stock-only — no indexer. `balance` is the sum of all fungible
    /// allocations the stock has seen (refined to wallet-owned UTXOs once the
    /// indexer lands). Empty for a fresh wallet.
    pub fn list_assets(&self) -> Result<String, JsError> {
        self.collect_assets(None)
    }

    /// Like `list_assets` but counts only allocations on `owned` outpoints
    /// (`["txid:vout", …]`, the wallet's UTXOs fetched from Esplora). A contract
    /// with no owned allocations still appears (balance 0).
    pub fn list_assets_owned(&self, owned_json: &str) -> Result<String, JsError> {
        let owned: std::collections::HashSet<String> =
            serde_json::from_str(owned_json).map_err(|e| JsError::new(&format!("parse owned: {e}")))?;
        self.collect_assets(Some(&owned))
    }

    /// The witness txids a consignment references, as a JSON array of hex strings.
    /// The caller fetches each txid's chain status from Esplora and passes it to
    /// `accept_consignment`.
    pub fn consignment_witness_ids(&self, consignment: &[u8]) -> Result<String, JsError> {
        let transfer = Transfer::load(consignment).map_err(|e| JsError::new(&format!("load consignment: {e}")))?;
        let mut ids: Vec<String> = Vec::new();
        for bw in transfer.bundles.iter() {
            if let Some(tx) = bw.pub_witness.tx() {
                let id = tx.txid().to_string();
                if !ids.contains(&id) {
                    ids.push(id);
                }
            }
        }
        Ok(serde_json::Value::Array(ids.into_iter().map(serde_json::Value::String).collect()).to_string())
    }

    /// Accept (import) a consignment into the stock. `ords_json` is the caller's
    /// Esplora-fetched witness status: `[{ "txid", "height"?, "time"? }]` (height +
    /// time present → Mined, else Tentative). Validates + accepts + promotes
    /// witnesses with a JS-fed resolver (tx from the consignment, ord from
    /// Esplora). Call `save()` afterward to persist.
    pub fn accept_consignment(&mut self, consignment: &[u8], ords_json: &str, network: &str) -> Result<(), JsError> {
        let transfer = Transfer::load(consignment).map_err(|e| JsError::new(&format!("load consignment: {e}")))?;
        let cn = chain_net(network)?;
        let ords = parse_ords(ords_json)?;

        // Resolver: the consignment carries the txes; the caller supplies the ord.
        let mut statuses: HashMap<Txid, WitnessStatus> = HashMap::new();
        for bw in transfer.bundles.iter() {
            if let Some(tx) = bw.pub_witness.tx() {
                let txid = tx.txid();
                let ord = ords.get(&txid).cloned().unwrap_or(WitnessOrd::Tentative);
                statuses.insert(txid, WitnessStatus::Resolved(tx.clone(), ord));
            }
        }
        let resolver = JsResolver { statuses, chain_net: cn };

        // NIA schema (idempotent) so a fresh stock can validate NIA consignments.
        let kit = Kit::load(&mut &NIA_SCHEMA_KIT[..])
            .map_err(|e| JsError::new(&format!("load NIA kit: {e}")))?
            .validate()
            .map_err(|e| JsError::new(&format!("validate NIA kit: {e:?}")))?;
        self.stock
            .import_kit(kit)
            .map_err(|e| JsError::new(&format!("import NIA kit: {e}")))?;

        let config = ValidationConfig {
            chain_net: cn,
            trusted_typesystem: self
                .stock
                .as_stash_provider()
                .type_system()
                .map_err(|e| JsError::new(&format!("type system: {e}")))?
                .clone(),
            ..Default::default()
        };

        let validated = transfer
            .validate(&resolver, &config)
            .map_err(|e| JsError::new(&format!("consignment validation: {e:?}")))?;
        if validated.validation_status().validity() != Validity::Valid {
            return Err(JsError::new(&format!("consignment invalid: {}", validated.validation_status())));
        }
        self.stock
            .accept_transfer(validated, &resolver)
            .map_err(|e| JsError::new(&format!("accept_transfer: {e}")))?;
        self.stock
            .update_witnesses(resolver, 0, vec![])
            .map_err(|e| JsError::new(&format!("update_witnesses: {e}")))?;
        Ok(())
    }

    /// Build a witness-vout RGB receive invoice for `amount` of `contract_id`, to
    /// a fresh keychain-10 address derived from `descriptor`. No anchor/UTXO needed
    /// — the RGB lands on a NEW output of the maker's swap tx, which the wallet
    /// owns (keychain-10) and recognizes once the swap confirms. No stash mutation,
    /// so nothing to persist.
    pub fn create_invoice(&self, descriptor: &str, contract_id: &str, amount: u64, network: &str) -> Result<String, JsError> {
        let cid = ContractId::from_str(contract_id)
            .map_err(|e| JsError::new(&format!("invalid contract id: {e}")))?;
        let net = btc_network(network)?;
        let xpub = XpubDerivable::from_str(descriptor)
            .map_err(|e| JsError::new(&format!("parse descriptor: {e}")))?;
        let rgb_descr: RgbDescr = TapretKey::from(xpub).into();
        let mut wallet: Wallet<XpubDerivable, RgbDescr> = Wallet::new_layer1(rgb_descr, net);
        let addr = wallet.next_address(RgbKeychain::Tapret, false);
        let beneficiary = Beneficiary::WitnessVout(Pay2Vout::new(addr.payload), None);

        let mut builder = RgbInvoiceBuilder::new(XChainNet::bitcoin(net, beneficiary))
            .set_contract(cid)
            .set_amount_raw(amount);
        // Name the assignment for unambiguous single-assignment fungible schemas
        // (e.g. NIA); leave unset for ambiguous schemas (still a usable invoice).
        if let Ok(contract) = self.stock.contract_data(cid) {
            let atypes = contract.schema.assignment_types_for_state(StateType::Fungible);
            if atypes.len() == 1 {
                let name = contract.schema.assignment_name(*atypes[0]).clone();
                builder = builder.set_assignment_name(name);
            }
        }
        Ok(builder.finish().to_string())
    }
}

// Non-exported helpers + the per-asset aggregation.
impl RgbStock {
    fn collect_assets(&self, owned: Option<&std::collections::HashSet<String>>) -> Result<String, JsError> {
        let contracts: Vec<_> = self
            .stock
            .contracts()
            .map_err(|e| JsError::new(&format!("contracts: {e}")))?
            .collect();
        let mut out = Vec::with_capacity(contracts.len());
        for info in contracts {
            let cid = info.id;
            let contract = self
                .stock
                .contract_data(cid)
                .map_err(|e| JsError::new(&format!("contract_data: {e}")))?;
            let (ticker, precision) = match contract.global("spec").next() {
                Some(v) => {
                    let spec = AssetSpec::from_strict_val_unchecked(&v);
                    (spec.ticker().to_owned(), spec.precision.decimals())
                }
                None => (cid.to_string(), 0u8),
            };
            let mut balance: u64 = 0;
            for details in contract.schema.owned_types.values() {
                if let Ok(allocs) = contract.fungible(details.name.clone(), &FilterIncludeAll) {
                    for alloc in allocs {
                        let include = match owned {
                            Some(set) => set.contains(&alloc.seal.to_outpoint().to_string()),
                            None => true,
                        };
                        if include {
                            balance = balance.saturating_add(alloc.state.value());
                        }
                    }
                }
            }
            out.push(serde_json::json!({
                "contractId": cid.to_string(),
                "ticker": ticker,
                "precision": precision,
                "balance": balance,
            }));
        }
        Ok(serde_json::Value::Array(out).to_string())
    }
}

fn btc_network(network: &str) -> Result<Network, JsError> {
    Ok(match network.to_ascii_lowercase().as_str() {
        "mainnet" | "bitcoin" => Network::Mainnet,
        "signet" => Network::Signet,
        "testnet" | "testnet3" => Network::Testnet3,
        "testnet4" => Network::Testnet4,
        "regtest" => Network::Regtest,
        other => return Err(JsError::new(&format!("unknown network: {other}"))),
    })
}

fn chain_net(network: &str) -> Result<ChainNet, JsError> {
    Ok(match network.to_ascii_lowercase().as_str() {
        "mainnet" | "bitcoin" => ChainNet::BitcoinMainnet,
        "signet" => ChainNet::BitcoinSignet,
        "testnet" | "testnet3" => ChainNet::BitcoinTestnet3,
        "regtest" => ChainNet::BitcoinRegtest,
        other => return Err(JsError::new(&format!("unknown network: {other}"))),
    })
}

fn parse_ords(json: &str) -> Result<HashMap<Txid, WitnessOrd>, JsError> {
    let val: serde_json::Value =
        serde_json::from_str(json).map_err(|e| JsError::new(&format!("parse ords: {e}")))?;
    let arr = val.as_array().ok_or_else(|| JsError::new("ords must be a JSON array"))?;
    let mut ords = HashMap::new();
    for e in arr {
        let txid_str = e
            .get("txid")
            .and_then(|v| v.as_str())
            .ok_or_else(|| JsError::new("ord entry missing txid"))?;
        let txid = Txid::from_str(txid_str).map_err(|e| JsError::new(&format!("bad txid: {e}")))?;
        let height = e.get("height").and_then(|v| v.as_u64());
        let time = e.get("time").and_then(|v| v.as_i64());
        let ord = match (height, time) {
            (Some(h), Some(t)) if h > 0 => {
                let height = NonZeroU32::new(h as u32).ok_or_else(|| JsError::new("bad height"))?;
                WitnessOrd::Mined(
                    WitnessPos::bitcoin(height, t).ok_or_else(|| JsError::new("bad witness pos"))?,
                )
            }
            _ => WitnessOrd::Tentative,
        };
        ords.insert(txid, ord);
    }
    Ok(ords)
}

/// A synchronous [`ResolveWitness`] fed entirely by the caller (JS): the tx comes
/// from the consignment, the ord (Mined/Tentative) from an Esplora HTTP lookup
/// done in JS. This is the wasm side of the "JS-fed resolver" edge — wasm can't
/// open sockets or block on fetch, so all chain data is pre-supplied.
struct JsResolver {
    statuses: HashMap<Txid, WitnessStatus>,
    chain_net: ChainNet,
}

impl ResolveWitness for JsResolver {
    fn resolve_witness(&self, witness_id: Txid) -> Result<WitnessStatus, WitnessResolverError> {
        Ok(self
            .statuses
            .get(&witness_id)
            .cloned()
            .unwrap_or(WitnessStatus::Unresolved))
    }

    fn check_chain_net(&self, chain_net: ChainNet) -> Result<(), WitnessResolverError> {
        if chain_net == self.chain_net {
            Ok(())
        } else {
            Err(WitnessResolverError::WrongChainNet)
        }
    }
}

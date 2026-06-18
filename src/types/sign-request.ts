// The contract the sign screen consumes. The background worker builds this by
// decoding the unsigned PSBT (from the maker, via the broker) plus RGB transfer
// metadata. Amounts here are ALWAYS wallet-derived — never trusted from the dApp.
// See docs/sign-request.md (the contract) and docs/swap-flow.md (the swap flow).

export type AssetSym = string // 'USDT-RGB', 'RGBX', 'tBTC', …

/** Which PSBT input the wallet must sign + the key derivation to sign it with.
 *  The wallet tells the signer explicitly — it does not rely on the maker's PSBT
 *  carrying our bip32/tap derivation. */
export interface SignInput {
  index: number // PSBT input index
  keychain: number // 0 receive · 1 change · 10 tapret
  addrIndex: number // derivation index within the keychain
}

export interface BalanceDelta {
  sym: AssetSym
  delta: number // signed: negative = outflow, positive = inflow
  usd: number // wallet-priced, display only
  isRgb: boolean
}

export interface PsbtLeg {
  label: string // 'USDT-RGB seal', 'tBTC (fee)', 'RGBX → you', 'Change → you'
  detail: string // 'utxo c2e1…7af2:0' | 'seal 8b…d4:0' | 'tb1q…0qz3'
  amount: string // preformatted, e.g. '1,500 USDT-RGB'
}

export interface SignRequest {
  id: string // pending-request id (resolve/reject key)
  origin: string // 'app.colorex.io'
  faviconUrl?: string
  recognized: boolean // known/connected origin? → trust pill + risk branch
  action: 'Sign transaction'
  intent: string // 'Swap on Colorex'
  counterparty?: string // maker id / 'pool:…'
  contract: { kind: string; id: string } // {'RGB-20 transfer', 'rgb:2Yx…RX01'}

  deltas: BalanceDelta[] // ⭐ the simulated outcome — DERIVED, never dApp-supplied
  rate?: string // '1 USDT-RGB = 0.39 RGBX' (swaps only)

  fee: { rateSatVb: number; btc: number; usd: number }
  network: 'signet' | 'testnet' | 'mainnet' | string

  inputs: PsbtLeg[]
  outputs: PsbtLeg[]
  psbtBase64: string // unsigned PSBT (from the maker, via /accept)
  consignment?: string // RGB consignment ref / blob

  // Wallet-DERIVED swap txid (the unsigned tx's id, == eventual witness txid). The exempt
  // witness for the SPV pre-sign gate — the not-yet-broadcast swap tx. Never dApp-supplied.
  swapTxid?: string

  // Colorex correlation for the /sign call.
  quoteId?: string

  // Which inputs the approval window must sign + their derivations (from decode).
  signInputs?: SignInput[]

  // A prominent, WALLET-DERIVED risk warning to surface above the balance changes. Set
  // when the wallet can't fully verify the swap but isn't hard-refusing — e.g. a sell that
  // spends RGB anchors with no consignment to confirm what comes back, where the user must
  // see the full amount at risk of being drained before approving.
  warning?: string
}

export type SignResult =
  // The wallet signs and returns the signed PSBT; the dApp submits it to the
  // broker (the maker finalizes + broadcasts). txid is filled in only if the
  // wallet later learns it.
  | { ok: true; signedPsbt: string; txid?: string; consignment?: string }
  | {
      ok: false
      error: 'user_rejected' | 'sign_failed' | 'broadcast_failed'
      message?: string
    }

//! Bitcoin difficulty-retarget validation — the piece that makes header proof-of-work
//! *trustworthy* rather than self-asserted (Tier-2 mainnet hardening, RFQIP-1 §3).
//!
//! ## Why this exists
//! A header carries its own difficulty target in the `bits` field, and the PoW check is
//! "hash ≤ target". But the attacker *writes* `bits` — so on its own, PoW-meets-stated-bits
//! is forgeable for free (claim minimum difficulty, mine on a laptop). The fix is to
//! independently **recompute** the required difficulty from the previous epoch's block
//! timestamps and reject any header whose `bits` disagree. Then every block must carry the
//! real network difficulty, and forging the chain costs real Bitcoin-scale work.
//!
//! This mirrors Bitcoin Core's `arith_uint256::SetCompact`/`GetCompact` and
//! `CalculateNextWorkRequired`. Difficulty only changes every [`RETARGET_INTERVAL`] (2016)
//! blocks — one "epoch" ≈ 2 weeks; within an epoch every block shares the epoch's `bits`.
//!
//! Targets are 256-bit big-endian `[u8; 32]`, matching `header[36..68]`-style layout and
//! directly `Ord`-comparable (big-endian byte order == numeric order).

/// Blocks per difficulty epoch (one retarget interval).
pub const RETARGET_INTERVAL: u32 = 2016;

/// Target timespan for one epoch: 2016 × 10 min = 2 weeks, in seconds.
const TARGET_TIMESPAN: u64 = 14 * 24 * 60 * 60; // 1_209_600

/// Mainnet minimum difficulty (difficulty-1) target, compact form.
pub const POW_LIMIT_BITS: u32 = 0x1d00_ffff;

/// Compact "nBits" → 256-bit target (big-endian). Bitcoin `SetCompact` (non-negative).
pub fn target_from_compact(bits: u32) -> [u8; 32] {
    let exponent = (bits >> 24) as usize;
    let mantissa = bits & 0x007f_ffff;
    let mut target = [0u8; 32];
    if exponent <= 3 {
        let shifted = mantissa >> (8 * (3 - exponent));
        target[29] = (shifted >> 16) as u8;
        target[30] = (shifted >> 8) as u8;
        target[31] = shifted as u8;
    } else {
        let mant = [
            (mantissa >> 16) as u8,
            (mantissa >> 8) as u8,
            mantissa as u8,
        ];
        // MSB of the mantissa sits at big-endian index 32 - exponent.
        let idx = 32usize.wrapping_sub(exponent);
        for (j, b) in mant.iter().enumerate() {
            let pos = idx.wrapping_add(j);
            if pos < 32 {
                target[pos] = *b;
            }
        }
    }
    target
}

/// 256-bit target (big-endian) → compact "nBits". Bitcoin `GetCompact` (non-negative).
pub fn compact_from_target(target: &[u8; 32]) -> u32 {
    // Number of significant bytes (size), and the top 3 as the mantissa.
    let first_nonzero = target.iter().position(|&b| b != 0).unwrap_or(32);
    let size = (32 - first_nonzero) as u32;
    if size == 0 {
        return 0;
    }
    let b0 = target[first_nonzero] as u32;
    let b1 = target.get(first_nonzero + 1).copied().unwrap_or(0) as u32;
    let b2 = target.get(first_nonzero + 2).copied().unwrap_or(0) as u32;
    let mut mantissa = (b0 << 16) | (b1 << 8) | b2;
    let mut nsize = size;
    // If the high mantissa bit is set it would look negative; shift right a byte and bump size.
    if mantissa & 0x0080_0000 != 0 {
        mantissa >>= 8;
        nsize += 1;
    }
    (nsize << 24) | (mantissa & 0x007f_ffff)
}

/// Multiply a 256-bit big-endian value by `m` (low 256 bits; overflow beyond 256 is dropped,
/// which never happens for real targets × clamped timespan).
fn mul_u64(a: &[u8; 32], m: u64) -> [u8; 32] {
    let mut res = [0u8; 32];
    let mut carry: u128 = 0;
    for i in (0..32).rev() {
        let prod = a[i] as u128 * m as u128 + carry;
        res[i] = (prod & 0xff) as u8;
        carry = prod >> 8;
    }
    res
}

/// Divide a 256-bit big-endian value by `d` (`d > 0`).
fn div_u64(a: &[u8; 32], d: u64) -> [u8; 32] {
    let mut res = [0u8; 32];
    let mut rem: u128 = 0;
    let d = d as u128;
    for i in 0..32 {
        let cur = (rem << 8) | a[i] as u128;
        res[i] = (cur / d) as u8;
        rem = cur % d;
    }
    res
}

/// Expected compact `bits` for the block at a retarget boundary — Bitcoin
/// `CalculateNextWorkRequired`. `last_bits`/`last_time` are the previous epoch's *last* block
/// (height `H-1`); `first_time` is its *first* block (height `H-2016`).
///
/// `new_target = clamp(actual/expected, ¼, 4) × old_target`, capped at the pow limit.
pub fn expected_retarget_bits(last_bits: u32, last_time: u32, first_time: u32) -> u32 {
    let mut actual = last_time.saturating_sub(first_time) as u64;
    actual = actual.clamp(TARGET_TIMESPAN / 4, TARGET_TIMESPAN * 4);
    let old = target_from_compact(last_bits);
    let mut new_t = div_u64(&mul_u64(&old, actual), TARGET_TIMESPAN);
    let limit = target_from_compact(POW_LIMIT_BITS);
    if new_t > limit {
        new_t = limit;
    }
    compact_from_target(&new_t)
}


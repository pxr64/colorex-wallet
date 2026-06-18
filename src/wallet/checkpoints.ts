// Baked SPV checkpoints — the trust floor for mined-ancestry verification (RFQIP-1).
//
// One trusted (height, block_hash) per difficulty epoch (2016 blocks). These are auditable
// constants shipped in the binary; the wallet validates header runs against them and never
// trusts a server's headers without anchoring to one. RGB only dates to ~2023, so the table is
// dozens of hashes (RGB-era → release), not 440-from-genesis. Refresh each wallet release; a
// background task extends it forward locally (see the design doc).
//
// IMPORTANT: the table's LOWEST checkpoint must sit at/below the earliest contract genesis the
// wallet will verify — a witness below all checkpoints can't be anchored. Extend downward if a
// consignment references older ancestry. (Gap C1: generate the full table.)

export interface Checkpoint {
  height: number
  blockHash: string // display-order hex
}

/** Epoch (2016-block) spacing — checkpoints sit on these boundaries on all networks. */
export const EPOCH = 2016

// Signet checkpoints (real signet epoch boundaries, fetched from mempool.space). Signet has no
// usable header PoW, so these anchor linkage only (network-gated in the verifier).
const SIGNET: Checkpoint[] = [
  { height: 296352, blockHash: '0000000f7041399c6814c4669cf9efdbe0f9e43333092b1728e1c642ef200fe0' },
  { height: 298368, blockHash: '0000000fdf5fba2aa660c8138272329f4f419541ac5a0b149e76ed5298c0072c' },
  { height: 300384, blockHash: '0000000afd0f694696061c61ec7674e49fc24b3809addd382d1589f5ac5fb056' },
  { height: 302400, blockHash: '000000032e81d4a3531d1f4add850effed51ba63f5ef52b2c20e209756a16d5f' },
  { height: 304416, blockHash: '00000013118f2cbb01e8e8247d290cabed3cc05868c0ca0c1fdb4ad50fdc00bd' },
  { height: 306432, blockHash: '0000000aa5843779b79cc22a204e5b04790586566062029ef2446ea86a1ecd59' },
  { height: 308448, blockHash: '0000000accc7006a32d35b4f759ab0885158dc1ce0ef27a823ecd8b350fea576' },
]

// Mainnet table — TODO (gap C1): epoch boundaries from RGB-launch (~2023) to release.
const MAINNET: Checkpoint[] = []

/** Baked checkpoints for a network (sorted ascending by height). */
export function bakedCheckpoints(network: string): Checkpoint[] {
  switch (network) {
    case 'signet':
      return SIGNET
    case 'mainnet':
      return MAINNET
    default:
      return [] // regtest / unknown: no checkpoints (caller falls back / errors)
  }
}

/** The highest checkpoint at or below `height` — the anchor for that witness's bounded run. */
export function nearestCheckpoint(checkpoints: Checkpoint[], height: number): Checkpoint | null {
  let best: Checkpoint | null = null
  for (const c of checkpoints) {
    if (c.height <= height && (!best || c.height > best.height)) best = c
  }
  return best
}

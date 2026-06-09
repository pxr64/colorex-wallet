import type { SignRequest } from '../types/sign-request'

// The prototype's hard-coded SIGN_REQ (INTEGRATION.md §4). Used to develop the
// sign screen before the worker's decode pipeline exists (open `index.html?id=mock`).
export const MOCK_SIGN_REQUEST: SignRequest = {
  id: 'mock',
  origin: 'app.colorex.io',
  recognized: true,
  action: 'Sign transaction',
  intent: 'Swap on Colorex',
  counterparty: 'pool:utx-rgbx/9af3',
  contract: { kind: 'RGB-20 transfer', id: 'rgb:2Yx…RX01' },
  deltas: [
    { sym: 'USDT-RGB', delta: -1500, usd: 1500, isRgb: true },
    { sym: 'RGBX', delta: 585, usd: 1485, isRgb: true },
  ],
  rate: '1 USDT-RGB = 0.39 RGBX',
  fee: { rateSatVb: 8, btc: 0.00002, usd: 1.3 },
  network: 'signet',
  inputs: [
    { label: 'USDT-RGB seal', detail: 'seal 8b…d4:0', amount: '1,500 USDT-RGB' },
    { label: 'tBTC (fee)', detail: 'utxo c2e1…7af2:0', amount: '0.00002 tBTC' },
  ],
  outputs: [
    { label: 'RGBX → you', detail: 'seal 3a…91:0', amount: '585 RGBX' },
    { label: 'Change → you', detail: 'tb1q…0qz3', amount: '0.00018 tBTC' },
  ],
  psbtBase64: 'cHNidP8B(mock-unsigned-psbt)',
  quoteId: 'mock-quote',
}

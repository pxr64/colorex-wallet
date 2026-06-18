// Pure unit formatting — no wasm/chrome, so it can be imported by test-pure modules
// (e.g. the swap RGB-delta logic) without pulling in the RGB stock.

/** Format a raw integer balance with `precision` decimals for display. */
export function formatUnits(raw: number, precision: number): string {
  const v = precision > 0 ? raw / Math.pow(10, precision) : raw
  return v.toLocaleString('en-US', { maximumFractionDigits: precision })
}

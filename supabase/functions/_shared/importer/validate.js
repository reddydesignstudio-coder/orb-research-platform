/**
 * Candle validation before storage (ARCHITECTURE.md §5: Normalize → Validate →
 * Deduplicate → PostgreSQL). Mirrors the candles table constraints, so one bad
 * row is reported with a reason instead of making the whole insert fail
 * (PROVIDERS.md §12; RULES.md — DATA 5). Nothing is corrected or adjusted.
 */

export const InvalidReason = Object.freeze({
  NON_POSITIVE_PRICE: 'NON_POSITIVE_PRICE',
  HIGH_NOT_HIGHEST: 'HIGH_NOT_HIGHEST',
  LOW_NOT_LOWEST: 'LOW_NOT_LOWEST',
});

/**
 * Exact comparison of two plain non-negative decimal strings ("12.30" vs "12.3").
 * @returns {-1|0|1}
 */
export function compareDecimal(a, b) {
  const [ai, af = ''] = a.split('.');
  const [bi, bf = ''] = b.split('.');
  const ia = ai.replace(/^0+(?=\d)/, '');
  const ib = bi.replace(/^0+(?=\d)/, '');
  if (ia.length !== ib.length) return ia.length < ib.length ? -1 : 1;
  if (ia !== ib) return ia < ib ? -1 : 1;
  const n = Math.max(af.length, bf.length);
  const fa = af.padEnd(n, '0');
  const fb = bf.padEnd(n, '0');
  return fa === fb ? 0 : fa < fb ? -1 : 1;
}

const isZero = (d) => /^0+(?:\.0+)?$/.test(d);

/** @returns {string|null} reason, or null when the candle is valid */
export function candleProblem(c) {
  if ([c.open, c.high, c.low, c.close].some(isZero)) return InvalidReason.NON_POSITIVE_PRICE;
  if ([c.open, c.close, c.low].some((p) => compareDecimal(c.high, p) < 0)) return InvalidReason.HIGH_NOT_HIGHEST;
  if ([c.open, c.close].some((p) => compareDecimal(c.low, p) > 0)) return InvalidReason.LOW_NOT_LOWEST;
  return null;
}

/**
 * @param {import('../providers/candle.js').NormalizedCandle[]} candles
 * @returns {{ valid: object[], invalid: { reason: string, candle: object }[] }}
 */
export function validateCandles(candles) {
  const valid = [];
  const invalid = [];
  for (const c of candles) {
    const reason = candleProblem(c);
    if (reason) invalid.push({ reason, candle: c });
    else valid.push(c);
  }
  return { valid, invalid };
}

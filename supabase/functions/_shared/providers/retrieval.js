/**
 * Historical retrieval: requests, results and range completeness
 * (PROVIDERS.md §1.1 items 4–5, §6, §12).
 *
 * Key rule (§6): progress is tracked by REQUESTED RANGES. A range counts as done
 * only when it has been definitively answered — never because "some candles came
 * back". assessCompleteness() is the single place that decides this.
 */

import { INTERVAL_1MIN, RejectReason, normalizeCandles, toUtcMinute } from './candle.js';
import { redactSecrets } from './errors.js';
import { isVerified, requireVerified } from './capabilities.js';

const MINUTE_MS = 60_000;

/**
 * @typedef {object} TimeRange   half-open [startUtc, endUtc)
 * @property {string} startUtc   ISO UTC, whole minute, inclusive
 * @property {string} endUtc     ISO UTC, whole minute, exclusive
 * @property {number} minutes    number of 1-minute slots in the range
 */

/**
 * @param {string|Date} start
 * @param {string|Date} end
 * @returns {TimeRange}
 */
export function defineRange(start, end) {
  const s = toUtcMinute(start);
  const e = toUtcMinute(end);
  if (!s.ok) throw new RangeError(`Invalid range start (${s.reason}): ${start}`);
  if (!e.ok) throw new RangeError(`Invalid range end (${e.reason}): ${end}`);
  const minutes = (Date.parse(e.iso) - Date.parse(s.iso)) / MINUTE_MS;
  if (minutes <= 0) throw new RangeError(`Range end must be after start: [${s.iso}, ${e.iso})`);
  return Object.freeze({ startUtc: s.iso, endUtc: e.iso, minutes });
}

/** @param {TimeRange} range @param {string} isoUtc */
export function rangeContains(range, isoUtc) {
  return isoUtc >= range.startUtc && isoUtc < range.endUtc; // ISO UTC strings sort chronologically
}

/**
 * Split a range into two halves on a minute boundary (for undetermined results).
 * @param {TimeRange} range
 * @returns {TimeRange[]}
 */
export function splitRange(range) {
  if (range.minutes < 2) throw new RangeError('A 1-minute range cannot be split further');
  const mid = new Date(Date.parse(range.startUtc) + Math.floor(range.minutes / 2) * MINUTE_MS);
  return [defineRange(range.startUtc, mid), defineRange(mid, range.endUtc)];
}

/**
 * @typedef {object} CandleRequest     what the importer asks an adapter for
 * @property {{ symbol: string, providerSymbol: string, provider: string }} symbol  from resolveSymbol()
 * @property {'1min'} interval
 * @property {TimeRange} range
 * @property {AbortSignal} [signal]
 */

/**
 * @param {{ symbol: object, range: TimeRange, interval?: string, signal?: AbortSignal }} p
 * @returns {CandleRequest}
 */
export function defineRequest({ symbol, range, interval = INTERVAL_1MIN, signal }) {
  if (interval !== INTERVAL_1MIN) {
    throw new RangeError(`Only 1-minute candles are retrieved from providers (got "${interval}")`);
  }
  if (!symbol || typeof symbol.providerSymbol !== 'string' || typeof symbol.provider !== 'string') {
    throw new TypeError('request.symbol must come from resolveSymbol()');
  }
  if (!range || typeof range.startUtc !== 'string' || typeof range.minutes !== 'number') {
    throw new TypeError('request.range must come from defineRange()');
  }
  return Object.freeze({ symbol, interval, range, ...(signal ? { signal } : {}) });
}

/**
 * Truncation as reported by the adapter for one response (§6).
 *   detected  the provider signalled, or the adapter established from VERIFIED
 *             provider semantics, that more candles exist in the same range
 *   none      the provider explicitly indicated nothing more exists in the range
 *   unknown   neither could be established
 * @enum {string}
 */
export const Truncation = Object.freeze({ DETECTED: 'detected', NONE: 'none', UNKNOWN: 'unknown' });

/**
 * @typedef {object} RetrievalResult
 * @property {string} provider
 * @property {string} providerSymbol
 * @property {TimeRange} requestedRange
 * @property {import('./candle.js').NormalizedCandle[]} candles   ascending, inside the range
 * @property {{ reason: string, field: string, raw: unknown }[]} rejected
 * @property {number} receivedCount        rows the provider returned, before normalization
 * @property {{ first: string, last: string } | null} coveredRange  of accepted candles
 * @property {string} truncation           Truncation value
 * @property {string[]} providerNotes      provider messages, secrets redacted
 */

/**
 * Build the result an adapter returns from fetchCandles(). Adapters extract raw
 * fields from their provider's response; this helper does the provider-neutral
 * rest: normalization, range check, counts, covered span and redaction.
 *
 * Candles outside the requested range are REJECTED with a reason, not dropped.
 *
 * @param {object} p
 * @param {CandleRequest} p.request
 * @param {import('./candle.js').RawCandleFields[]} p.rows
 * @param {string} p.truncation          Truncation value
 * @param {string[]} [p.providerNotes]
 * @param {string[]} [p.secrets]         values to redact from notes and rejected rows
 * @returns {RetrievalResult}
 */
export function buildRetrievalResult({ request, rows, truncation, providerNotes = [], secrets = [] }) {
  if (!Object.values(Truncation).includes(truncation)) {
    throw new TypeError(`truncation must be one of ${Object.values(Truncation).join(', ')}`);
  }
  const provider = request.symbol.provider;
  const { candles: normalized, rejected } = normalizeCandles(rows, { provider });

  const candles = [];
  for (const c of normalized) {
    if (rangeContains(request.range, c.timestampUtc)) candles.push(c);
    else rejected.push({ reason: RejectReason.OUTSIDE_REQUESTED_RANGE, field: 'timestamp', raw: c });
  }

  const redactedRejected = rejected.map((r) => ({
    reason: r.reason,
    field: r.field,
    raw: JSON.parse(redactSecrets(JSON.stringify(r.raw ?? null), secrets)),
  }));

  return Object.freeze({
    provider,
    providerSymbol: request.symbol.providerSymbol,
    requestedRange: request.range,
    candles: Object.freeze(candles),
    rejected: Object.freeze(redactedRejected),
    receivedCount: rows.length,
    coveredRange: candles.length ? { first: candles[0].timestampUtc, last: candles[candles.length - 1].timestampUtc } : null,
    truncation,
    providerNotes: Object.freeze(providerNotes.map((n) => redactSecrets(n, secrets))),
  });
}

/**
 * Range completeness decision (§6 rule 2). Pure function.
 *
 *   answered      the range was definitively answered; whatever is missing is
 *                 genuinely absent from the provider (interpretation belongs to
 *                 session / data-quality validation, §12)
 *   truncated     more data exists in this range → request the remainder
 *   undetermined  truncation cannot be ruled out → split the range; never mark done
 *
 * "none" from an adapter is only trusted when the provider's explicit truncation
 * signal is a VERIFIED capability. "unknown" is only accepted as answered when
 * the range fits within a VERIFIED maxSafeRangeMinutes.
 *
 * @param {RetrievalResult} result
 * @param {{ providerId: string, facts: object }} caps
 * @returns {{ state: 'answered'|'truncated'|'undetermined', reason: string, empty: boolean }}
 */
export function assessCompleteness(result, caps) {
  const empty = result.candles.length === 0 && result.rejected.length === 0;
  if (result.truncation === Truncation.DETECTED) {
    return { state: 'truncated', reason: 'Adapter reported truncation: more data exists in this range.', empty };
  }
  if (
    result.truncation === Truncation.NONE &&
    isVerified(caps, 'truncationSignal') &&
    requireVerified(caps, 'truncationSignal') === 'explicit'
  ) {
    return { state: 'answered', reason: 'Provider explicitly indicated nothing more exists in the range.', empty };
  }
  if (isVerified(caps, 'maxSafeRangeMinutes')) {
    const safe = requireVerified(caps, 'maxSafeRangeMinutes');
    if (result.requestedRange.minutes <= safe) {
      return { state: 'answered', reason: `Range (${result.requestedRange.minutes} min) is within the verified safe size (${safe} min).`, empty };
    }
  }
  return {
    state: 'undetermined',
    reason: 'Truncation cannot be ruled out with verified capabilities; the range must be split or re-requested.',
    empty,
  };
}

/**
 * For a truncated result: the part of the requested range still to fetch.
 * Needs the VERIFIED result order, because "what remains" depends on whether
 * the provider returns oldest-first or newest-first (§6 rule 3).
 *
 * The remainder deliberately OVERLAPS the boundary candle by one minute: a
 * re-received candle is only counted as a duplicate (§6 rule 5), whereas a gap
 * would skip data.
 *
 * Returns null when no progress can be made this way (nothing usable received,
 * or the remainder would be the whole range again) — the caller then splits the
 * range instead, so a misbehaving provider can never cause an endless loop.
 * @param {RetrievalResult} result
 * @param {object} caps
 * @returns {TimeRange|null}
 */
export function remainingRange(result, caps) {
  if (!result.coveredRange) return null;
  const order = requireVerified(caps, 'resultOrder');
  const { startUtc, endUtc } = result.requestedRange;
  if (order === 'ascending') {
    const from = result.coveredRange.last; // inclusive overlap
    return from > startUtc && from < endUtc ? defineRange(from, endUtc) : null;
  }
  const to = new Date(Date.parse(result.coveredRange.first) + MINUTE_MS).toISOString(); // overlap
  return to < endUtc && to > startUtc ? defineRange(startUtc, to) : null;
}

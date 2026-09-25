/**
 * Normalized 1-minute candle contract (PROVIDERS.md §2; DATABASE.md — candles).
 *
 * Adapters extract fields from their provider's response and pass them to
 * normalizeCandle(). This module performs the provider-neutral part:
 *   - the timestamp must already carry an explicit timezone (a UTC "Z" or a
 *     numeric offset). Naive timestamps are REJECTED, because interpreting them
 *     needs provider knowledge (timezone, bar start vs end) that is TO BE VERIFIED
 *     per provider and belongs in the adapter;
 *   - output timestamps are UTC and must fall on a whole minute;
 *   - prices and volume are kept as exact decimal strings (no float rounding);
 *   - a missing volume stays null — it is never turned into 0;
 *   - a row that cannot be normalized is returned as a rejection with a reason,
 *     never dropped silently (RULES.md — DATA 5).
 *
 * Price relationships (high ≥ low etc.) are NOT checked here: that is the
 * "Validate" step that follows normalization (ARCHITECTURE.md §5).
 */

export const INTERVAL_1MIN = '1min';

/** Provider identifiers: lower-case letters, digits, underscore. */
export const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** Plain non-negative decimal: "0", "12", "1.2345". No sign, no exponent, no spaces. */
const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** ISO-8601 with an explicit zone designator (Z or ±HH:MM / ±HHMM). */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * @typedef {object} NormalizedCandle
 * @property {string} timestampUtc  ISO-8601 UTC, whole minute: "YYYY-MM-DDTHH:MM:00.000Z"
 * @property {string} open          exact decimal string
 * @property {string} high
 * @property {string} low
 * @property {string} close
 * @property {string|null} volume   exact decimal string, or null when the provider has none
 * @property {string} provider      adapter id
 * @property {'1min'} interval
 */

/**
 * @typedef {object} RawCandleFields  fields an adapter extracted from one provider row
 * @property {string|Date} timestamp  instant WITH explicit timezone, already converted
 *                                    by the adapter to the start of the 1-minute bar
 * @property {string|number} open
 * @property {string|number} high
 * @property {string|number} low
 * @property {string|number} close
 * @property {string|number|null} [volume]
 */

/**
 * @typedef {{ ok: true, candle: NormalizedCandle }
 *         | { ok: false, reason: string, field: string, raw: unknown }} NormalizeResult
 */

/** Reasons a row can be rejected. */
export const RejectReason = Object.freeze({
  MISSING_FIELD: 'MISSING_FIELD',
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  TIMESTAMP_WITHOUT_TIMEZONE: 'TIMESTAMP_WITHOUT_TIMEZONE',
  TIMESTAMP_NOT_MINUTE_ALIGNED: 'TIMESTAMP_NOT_MINUTE_ALIGNED',
  INVALID_DECIMAL: 'INVALID_DECIMAL',
  OUTSIDE_REQUESTED_RANGE: 'OUTSIDE_REQUESTED_RANGE',
});

/**
 * @param {unknown} value
 * @returns {string|null} exact decimal string, or null if not a plain non-negative decimal
 */
export function toDecimalString(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // String(number) is the shortest round-trip form, i.e. the literal the provider sent
    // when it sent a JSON number. Exponent forms are rejected rather than reinterpreted.
    value = String(value);
  }
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return DECIMAL.test(s) ? s : null;
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, iso: string } | { ok: false, reason: string }}
 */
export function toUtcMinute(value) {
  let ms;
  if (value instanceof Date) {
    ms = value.getTime();
  } else if (typeof value === 'string') {
    const s = value.trim();
    if (!ISO_WITH_ZONE.test(s)) {
      const looksLikeTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s);
      return { ok: false, reason: looksLikeTime ? RejectReason.TIMESTAMP_WITHOUT_TIMEZONE : RejectReason.INVALID_TIMESTAMP };
    }
    ms = Date.parse(s.replace(' ', 'T'));
  } else {
    return { ok: false, reason: RejectReason.INVALID_TIMESTAMP };
  }
  if (!Number.isFinite(ms)) return { ok: false, reason: RejectReason.INVALID_TIMESTAMP };
  if (ms % 60_000 !== 0) return { ok: false, reason: RejectReason.TIMESTAMP_NOT_MINUTE_ALIGNED };
  return { ok: true, iso: new Date(ms).toISOString() };
}

/**
 * Normalize one row. Pure function.
 * @param {RawCandleFields} raw
 * @param {{ provider: string }} ctx
 * @returns {NormalizeResult}
 */
export function normalizeCandle(raw, { provider }) {
  if (typeof provider !== 'string' || !PROVIDER_ID_PATTERN.test(provider)) {
    throw new TypeError(`Invalid provider id: ${provider}`);
  }
  const reject = (reason, field) => ({ ok: false, reason, field, raw });

  if (raw === null || typeof raw !== 'object') return reject(RejectReason.MISSING_FIELD, 'row');

  for (const field of ['timestamp', 'open', 'high', 'low', 'close']) {
    if (raw[field] === undefined || raw[field] === null || raw[field] === '') {
      return reject(RejectReason.MISSING_FIELD, field);
    }
  }

  const ts = toUtcMinute(raw.timestamp);
  if (!ts.ok) return reject(ts.reason, 'timestamp');

  const prices = {};
  for (const field of ['open', 'high', 'low', 'close']) {
    const d = toDecimalString(raw[field]);
    if (d === null) return reject(RejectReason.INVALID_DECIMAL, field);
    prices[field] = d;
  }

  let volume = null;
  if (raw.volume !== undefined && raw.volume !== null && raw.volume !== '') {
    volume = toDecimalString(raw.volume);
    if (volume === null) return reject(RejectReason.INVALID_DECIMAL, 'volume');
  }

  return {
    ok: true,
    candle: Object.freeze({
      timestampUtc: ts.iso,
      open: prices.open,
      high: prices.high,
      low: prices.low,
      close: prices.close,
      volume,
      provider,
      interval: INTERVAL_1MIN,
    }),
  };
}

/**
 * Normalize every row of one provider response.
 * Candles come back sorted ascending by time; rejections keep their raw row.
 * Duplicates inside one response are kept: deduplication is a later step
 * (ARCHITECTURE.md §5) and is counted there.
 * @param {RawCandleFields[]} rows
 * @param {{ provider: string }} ctx
 */
export function normalizeCandles(rows, ctx) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  /** @type {NormalizedCandle[]} */
  const candles = [];
  /** @type {{ reason: string, field: string, raw: unknown }[]} */
  const rejected = [];
  for (const row of rows) {
    const r = normalizeCandle(row, ctx);
    if (r.ok) candles.push(r.candle);
    else rejected.push({ reason: r.reason, field: r.field, raw: r.raw });
  }
  candles.sort((a, b) => (a.timestampUtc < b.timestampUtc ? -1 : a.timestampUtc > b.timestampUtc ? 1 : 0));
  return { candles, rejected };
}

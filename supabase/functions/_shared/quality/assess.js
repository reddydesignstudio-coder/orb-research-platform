/**
 * Data quality — one session (TASK 014, D-029). Pure; no I/O.
 *
 * Input: a session from the session validator (TASK 013) and the candles stored
 * for that symbol around it. Output: the data_quality row for (symbol, date).
 *
 *   expected_candles   90 when the market is open, 0 when closed (weekend/holiday)
 *   actual_candles     distinct stored minutes inside the window
 *   missing_candles    expected minutes with no stored candle
 *   duplicate_candles  repeated timestamps among the stored candles (the database's
 *                      unique key makes this 0; counted anyway, never assumed)
 *   invalid_ohlc_candles       prices that break OHLC rules (also guarded by the database)
 *   invalid_timestamp_candles  candles inside the window on a CLOSED day, or not on a whole minute
 *   first_candle / last_candle first and last stored minute inside the window
 *
 * Status (checked in this order):
 *   invalid        any duplicate, invalid OHLC or invalid timestamp
 *   market_closed  closed day, no candles
 *   no_data        open day, no candles at all
 *   incomplete     open day, some expected minutes missing
 *   complete       open day, all expected minutes present
 * Nothing is dropped, filled or corrected here — the row only describes the data.
 */

import { candleProblem } from '../importer/validate.js';
import { localParts } from '../sessions/time.js';

const MINUTE = 60_000;
const MAX_LISTED = 50;

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Group consecutive missing minutes into local-time ranges: ["09:30", "10:02–10:05"]. */
export function missingRangesLocal(missingMs, timezone) {
  const out = [];
  let start = null;
  let prev = null;
  const flush = () => {
    if (start === null) return;
    const a = localParts(start, timezone).minutes;
    const b = localParts(prev, timezone).minutes;
    out.push(a === b ? hhmm(a) : `${hhmm(a)}–${hhmm(b)}`);
  };
  for (const ms of missingMs) {
    if (prev !== null && ms === prev + MINUTE) {
      prev = ms;
      continue;
    }
    flush();
    start = ms;
    prev = ms;
  }
  flush();
  return out;
}

/**
 * @param {ReturnType<import('../sessions/validator.js').sessionFor>} session
 * @param {{ timestampUtc: string, open: string, high: string, low: string, close: string }[]} candles
 *        stored candles; any outside the session window are ignored (they belong to no session)
 * @returns {object} data_quality row fields (without symbol_id)
 */
export function assessSession(session, candles) {
  const start = Date.parse(session.startUtc);
  const end = Date.parse(session.endUtc);
  const seen = new Set();
  let duplicates = 0;
  const invalidTimestamps = [];
  const invalidOhlc = [];
  for (const c of candles) {
    const ms = Date.parse(c.timestampUtc);
    if (!Number.isFinite(ms)) throw new TypeError(`Invalid candle timestamp "${c.timestampUtc}"`);
    if (ms < start || ms >= end) continue;
    const iso = new Date(ms).toISOString();
    if (ms % MINUTE !== 0) {
      invalidTimestamps.push({ at: iso, reason: 'NOT_ON_MINUTE' });
      continue;
    }
    if (seen.has(ms)) {
      duplicates += 1;
      continue;
    }
    seen.add(ms);
    if (!session.open) invalidTimestamps.push({ at: iso, reason: 'MARKET_CLOSED' });
    const problem = candleProblem(c);
    if (problem) invalidOhlc.push({ at: iso, reason: problem });
  }

  const present = [...seen].sort((a, b) => a - b);
  const missingMs = [];
  if (session.open) {
    for (let t = start; t < end; t += MINUTE) if (!seen.has(t)) missingMs.push(t);
  }
  const expected = session.expectedCandles;
  const invalid = duplicates + invalidTimestamps.length + invalidOhlc.length > 0;
  let status;
  if (invalid) status = 'invalid';
  else if (!session.open) status = 'market_closed';
  else if (!present.length) status = 'no_data';
  else status = missingMs.length ? 'incomplete' : 'complete';

  const details = { window: { startUtc: session.startUtc, endUtc: session.endUtc, label: session.window } };
  if (!session.open) details.closedReason = session.reason === 'weekend' ? 'weekend' : `${session.reason}: ${session.closedFor}`;
  if (missingMs.length && present.length) details.missing = missingRangesLocal(missingMs, session.timezone);
  if (invalidTimestamps.length) details.invalidTimestamps = invalidTimestamps.slice(0, MAX_LISTED);
  if (invalidOhlc.length) details.invalidOhlc = invalidOhlc.slice(0, MAX_LISTED);

  return {
    session_date: session.date,
    expected_candles: expected,
    actual_candles: present.length,
    missing_candles: missingMs.length,
    duplicate_candles: duplicates,
    invalid_ohlc_candles: invalidOhlc.length,
    invalid_timestamp_candles: invalidTimestamps.length,
    first_candle: present.length ? new Date(present[0]).toISOString() : null,
    last_candle: present.length ? new Date(present.at(-1)).toISOString() : null,
    status,
    details,
  };
}

/**
 * Session validator (TASK 013, D-028).
 *
 * A SESSION is one symbol's research window on one local calendar date:
 * symbols.session_start → session_end (end excluded) in symbols.session_timezone
 * (09:30 → 11:00 America/New_York for every symbol, D-025). A complete window is
 * one candle per minute: 90 candles (PROJECT.md §4).
 *
 * sessionFor() says whether the market is expected open (market calendar,
 * calendar.js), the window in UTC (DST-aware) and how many candles to expect.
 * checkSessionCandles() compares stored candle timestamps with that session:
 * which expected minutes are present / missing, and which timestamps do not
 * belong (outside the window, on a closed day, or not on a whole minute).
 * Weekends and holidays expect 0 candles — they are not missing data (RULES.md).
 *
 * OHLC validity, duplicates and writing data_quality rows are TASK 014.
 */

import { addDays, marketDay, parseDate } from './calendar.js';
import { localParts, localToUtcMs, minutesOf } from './time.js';

const MINUTE = 60_000;

export class SessionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

/** Validated research-window definition of a symbol row. */
export function sessionDefinition(symbol) {
  if (!symbol?.session_start || !symbol?.session_end || !symbol?.session_timezone) {
    throw new SessionError('SESSION_NOT_DEFINED', `"${symbol?.symbol ?? 'symbol'}" has no research window (session_timezone/start/end) configured.`);
  }
  const start = minutesOf(symbol.session_start);
  const end = minutesOf(symbol.session_end);
  if (!(end > start)) throw new SessionError('SESSION_INVALID', `Session end must be after start for "${symbol.symbol ?? 'symbol'}".`);
  localParts(0, symbol.session_timezone); // throws RangeError for an unknown zone
  return { timezone: symbol.session_timezone, start, end, market: symbol.market };
}

const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const localMs = (date, minutes, tz) => (minutes === 24 * 60 ? localToUtcMs(addDays(date, 1), 0, tz) : localToUtcMs(date, minutes, tz));

/**
 * @param {object} symbol  symbols row (symbol, market, session_timezone, session_start, session_end)
 * @param {string} date    local session date 'YYYY-MM-DD'
 */
export function sessionFor(symbol, date) {
  parseDate(date);
  const def = sessionDefinition(symbol);
  const day = marketDay(def.market, date);
  const startMs = localMs(date, def.start, def.timezone);
  const endMs = localMs(date, def.end, def.timezone);
  const windowMinutes = Math.round((endMs - startMs) / MINUTE);
  return Object.freeze({
    symbol: symbol.symbol,
    market: def.market,
    date,
    timezone: def.timezone,
    window: `${hhmm(def.start)}–${hhmm(def.end)} ${def.timezone}`,
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(), // excluded
    open: day.open,
    reason: day.reason,
    closedFor: day.name ?? null,
    calendar: day.calendar,
    expectedCandles: day.open ? windowMinutes : 0,
  });
}

/** Sessions for every local date in [fromDate, toDate) — closed days included. */
export function sessionsBetween(symbol, fromDate, toDate) {
  parseDate(fromDate);
  parseDate(toDate);
  const out = [];
  for (let d = fromDate; d < toDate; d = addDays(d, 1)) out.push(sessionFor(symbol, d));
  return out;
}

/** Expected candle timestamps (UTC ISO, one per minute) of a session; [] when closed. */
export function expectedMinutes(session) {
  if (!session.open) return [];
  const out = [];
  for (let t = Date.parse(session.startUtc); t < Date.parse(session.endUtc); t += MINUTE) out.push(new Date(t).toISOString());
  return out;
}

/** Local session date of a UTC timestamp for a symbol (the date the bar belongs to). */
export function sessionDateOf(symbol, isoUtc) {
  return localParts(isoUtc, sessionDefinition(symbol).timezone).date;
}

/**
 * Compare a session with the timestamps of candles stored for that date.
 * @param {ReturnType<typeof sessionFor>} session
 * @param {string[]} timestamps  UTC ISO timestamps (any order; duplicates counted once here)
 * @returns {{ expected: number, present: number, missing: string[], outsideWindow: string[],
 *             onClosedDay: string[], notOnMinute: string[], firstCandle: string|null, lastCandle: string|null,
 *             status: 'complete'|'incomplete'|'no_data'|'market_closed'|'unexpected_candles' }}
 */
export function checkSessionCandles(session, timestamps) {
  const start = Date.parse(session.startUtc);
  const end = Date.parse(session.endUtc);
  const seen = new Set();
  const outsideWindow = [];
  const onClosedDay = [];
  const notOnMinute = [];
  for (const ts of timestamps) {
    const ms = Date.parse(ts);
    if (!Number.isFinite(ms)) throw new TypeError(`Invalid candle timestamp "${ts}"`);
    const iso = new Date(ms).toISOString();
    if (ms % MINUTE !== 0) notOnMinute.push(iso);
    else if (ms < start || ms >= end) outsideWindow.push(iso);
    else if (!session.open) onClosedDay.push(iso);
    else seen.add(ms);
  }
  const expected = expectedMinutes(session);
  const missing = expected.filter((iso) => !seen.has(Date.parse(iso)));
  const inWindow = [...seen].sort((a, b) => a - b);
  let status;
  if (!session.open) status = onClosedDay.length ? 'unexpected_candles' : 'market_closed';
  else if (!inWindow.length) status = 'no_data';
  else status = missing.length ? 'incomplete' : 'complete';
  return {
    expected: session.expectedCandles,
    present: inWindow.length,
    missing,
    outsideWindow,
    onClosedDay,
    notOnMinute,
    firstCandle: inWindow.length ? new Date(inWindow[0]).toISOString() : null,
    lastCandle: inWindow.length ? new Date(inWindow.at(-1)).toISOString() : null,
    status,
  };
}

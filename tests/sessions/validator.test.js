/** Session validator (TASK 013, D-028): expected sessions, DST-aware UTC windows, candle checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SessionError, checkSessionCandles, expectedMinutes, sessionDateOf, sessionFor, sessionsBetween,
} from '../../supabase/functions/_shared/sessions/validator.js';
import { localToUtcMs } from '../../supabase/functions/_shared/sessions/time.js';

const row = (symbol, market) => ({ symbol, market, session_timezone: 'America/New_York', session_start: '09:30:00', session_end: '11:00:00' });
const SPY = row('SPY', 'us_stock');
const EUR = row('EUR/USD', 'forex');
const BTC = row('BTC/USD', 'crypto');
const XAU = row('XAU/USD', 'gold');

test('open US stock day: 90 expected candles, window in UTC follows EDT/EST', () => {
  const summer = sessionFor(SPY, '2026-07-01');
  assert.deepEqual([summer.open, summer.expectedCandles, summer.startUtc, summer.endUtc],
    [true, 90, '2026-07-01T13:30:00.000Z', '2026-07-01T15:00:00.000Z']);
  assert.equal(summer.window, '09:30–11:00 America/New_York');
  const winter = sessionFor(SPY, '2026-01-15');
  assert.deepEqual([winter.startUtc, winter.endUtc], ['2026-01-15T14:30:00.000Z', '2026-01-15T16:00:00.000Z']);
});

test('DST change weekends: the Monday after each change uses the new offset and still expects 90', () => {
  assert.equal(sessionFor(SPY, '2026-03-06').startUtc, '2026-03-06T14:30:00.000Z'); // EST
  assert.equal(sessionFor(SPY, '2026-03-09').startUtc, '2026-03-09T13:30:00.000Z'); // EDT
  assert.equal(sessionFor(SPY, '2026-10-30').startUtc, '2026-10-30T13:30:00.000Z'); // EDT
  assert.equal(sessionFor(SPY, '2026-11-02').startUtc, '2026-11-02T14:30:00.000Z'); // EST
  // Crypto trades on the change days themselves (Sundays): still 90 minutes.
  for (const d of ['2026-03-08', '2026-11-01', '2025-11-02']) assert.equal(sessionFor(BTC, d).expectedCandles, 90, d);
  assert.equal(sessionFor(BTC, '2026-03-08').startUtc, '2026-03-08T13:30:00.000Z');
  assert.equal(sessionFor(BTC, '2026-11-01').startUtc, '2026-11-01T14:30:00.000Z');
});

test('closed days expect 0 candles and say why', () => {
  const sat = sessionFor(SPY, '2026-09-26');
  assert.deepEqual([sat.open, sat.reason, sat.expectedCandles], [false, 'weekend', 0]);
  const xmas = sessionFor(XAU, '2025-12-25');
  assert.deepEqual([xmas.open, xmas.reason, xmas.closedFor], [false, 'holiday', 'Christmas Day']);
  assert.equal(sessionFor(EUR, '2025-11-27').expectedCandles, 90, 'Thanksgiving: FX open');
  assert.equal(sessionFor(SPY, '2025-11-27').expectedCandles, 0);
  assert.equal(sessionFor(BTC, '2026-09-26').expectedCandles, 90);
});

test('sessionsBetween: one per local date, closed days included; a US stock week has 5 open sessions', () => {
  const week = sessionsBetween(SPY, '2026-09-21', '2026-09-28');
  assert.equal(week.length, 7);
  assert.equal(week.filter((s) => s.open).length, 5);
  assert.equal(sessionsBetween(BTC, '2026-09-21', '2026-09-28').filter((s) => s.open).length, 7);
  // Thanksgiving week 2025
  assert.equal(sessionsBetween(SPY, '2025-11-24', '2025-12-01').filter((s) => s.open).length, 4);
});

test('one year of history from 2025-09-26: open-session counts per market', () => {
  const count = (sym) => sessionsBetween(sym, '2025-09-26', '2026-09-26').filter((s) => s.open).length;
  // 365 days, 52 weeks + 1 day (Fri 2025-09-26) → 261 weekdays.
  assert.equal(count(BTC), 365);
  assert.equal(count(EUR), 261 - 2, 'minus 25 Dec 2025 and 1 Jan 2026');
  // NYSE holidays in range: 2025-11-27, 2025-12-25, 2026-01-01, 01-19, 02-16, 04-03, 05-25, 06-19, 07-03, 09-07 → 10.
  assert.equal(count(SPY), 261 - 10);
});

test('expectedMinutes: 90 whole minutes from 09:30 to 10:59 local; none when closed', () => {
  const m = expectedMinutes(sessionFor(SPY, '2026-07-01'));
  assert.equal(m.length, 90);
  assert.equal(m[0], '2026-07-01T13:30:00.000Z');
  assert.equal(m.at(-1), '2026-07-01T14:59:00.000Z');
  assert.deepEqual(expectedMinutes(sessionFor(SPY, '2026-07-03')), []);
});

test('sessionDateOf uses the local date, not the UTC date', () => {
  assert.equal(sessionDateOf(SPY, '2026-07-02T02:00:00Z'), '2026-07-01');
  assert.equal(sessionDateOf(SPY, '2026-07-01T13:30:00Z'), '2026-07-01');
});

test('checkSessionCandles: complete, incomplete, no data', () => {
  const s = sessionFor(SPY, '2026-07-01');
  const all = expectedMinutes(s);
  const full = checkSessionCandles(s, [...all].reverse());
  assert.deepEqual([full.status, full.present, full.missing.length, full.firstCandle, full.lastCandle],
    ['complete', 90, 0, '2026-07-01T13:30:00.000Z', '2026-07-01T14:59:00.000Z']);
  const gap = checkSessionCandles(s, all.filter((_, i) => i !== 0 && i !== 45));
  assert.deepEqual([gap.status, gap.present, gap.missing], ['incomplete', 88, ['2026-07-01T13:30:00.000Z', '2026-07-01T14:15:00.000Z']]);
  assert.equal(checkSessionCandles(s, []).status, 'no_data');
  assert.equal(checkSessionCandles(s, [...all, all[3]]).present, 90, 'a repeated timestamp counts once here (duplicates: TASK 014)');
});

test('checkSessionCandles: timestamps that do not belong are reported, never silently dropped', () => {
  const s = sessionFor(SPY, '2026-07-01');
  const r = checkSessionCandles(s, ['2026-07-01T13:29:00Z', '2026-07-01T15:00:00Z', '2026-07-01T13:30:30Z', '2026-07-01T13:31:00Z']);
  assert.deepEqual(r.outsideWindow, ['2026-07-01T13:29:00.000Z', '2026-07-01T15:00:00.000Z'], '09:29 and 11:00 are outside');
  assert.deepEqual(r.notOnMinute, ['2026-07-01T13:30:30.000Z']);
  assert.equal(r.present, 1);
  const closed = sessionFor(SPY, '2026-07-03');
  assert.equal(checkSessionCandles(closed, []).status, 'market_closed');
  const odd = checkSessionCandles(closed, ['2026-07-03T13:45:00Z']);
  assert.deepEqual([odd.status, odd.onClosedDay], ['unexpected_candles', ['2026-07-03T13:45:00.000Z']]);
});

test('symbols without a research window, or with a bad one, are errors with a code', () => {
  assert.throws(() => sessionFor({ symbol: 'X', market: 'forex', session_timezone: 'UTC', session_start: null, session_end: null }, '2026-01-05'),
    (e) => e instanceof SessionError && e.code === 'SESSION_NOT_DEFINED');
  assert.throws(() => sessionFor({ ...SPY, session_end: '09:00:00' }, '2026-01-05'), (e) => e.code === 'SESSION_INVALID');
  assert.throws(() => sessionFor({ ...SPY, session_timezone: 'Mars/Base' }, '2026-01-05'), RangeError);
});

test('localToUtcMs: DST gap is refused; overlap resolves to the first occurrence', () => {
  assert.throws(() => localToUtcMs('2026-03-08', 150, 'America/New_York'), /does not exist/); // 02:30
  assert.equal(new Date(localToUtcMs('2026-11-01', 90, 'America/New_York')).toISOString(), '2026-11-01T05:30:00.000Z'); // 01:30 EDT
  assert.equal(new Date(localToUtcMs('2026-06-01', 0, 'Europe/London')).toISOString(), '2026-05-31T23:00:00.000Z');
});

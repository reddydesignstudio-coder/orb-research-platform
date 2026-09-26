/** Data quality of one session (TASK 014, D-029): counts, status, details — pure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessSession, missingRangesLocal } from '../../supabase/functions/_shared/quality/assess.js';
import { expectedMinutes, sessionFor } from '../../supabase/functions/_shared/sessions/validator.js';

const SPY = { symbol: 'SPY', market: 'us_stock', session_timezone: 'America/New_York', session_start: '09:30:00', session_end: '11:00:00' };
const XAU = { ...SPY, symbol: 'XAU/USD', market: 'gold' };
const c = (timestampUtc, o = {}) => ({ timestampUtc, open: '10.1', high: '10.5', low: '10', close: '10.2', ...o });
const open = sessionFor(SPY, '2025-10-10');
const all = expectedMinutes(open).map((t) => c(t));

test('complete: 90/90, first 09:30 and last 10:59 New York', () => {
  const r = assessSession(open, all);
  assert.deepEqual(
    [r.status, r.expected_candles, r.actual_candles, r.missing_candles, r.duplicate_candles, r.invalid_ohlc_candles, r.invalid_timestamp_candles],
    ['complete', 90, 90, 0, 0, 0, 0]);
  assert.deepEqual([r.first_candle, r.last_candle], ['2025-10-10T13:30:00.000Z', '2025-10-10T14:59:00.000Z']);
  assert.equal(r.details.window.label, '09:30–11:00 America/New_York');
  assert.equal(r.details.missing, undefined);
});

test('incomplete: missing minutes listed as New York time ranges', () => {
  const r = assessSession(open, all.filter((_, i) => ![1, 2, 3, 40, 89].includes(i)));
  assert.deepEqual([r.status, r.actual_candles, r.missing_candles], ['incomplete', 85, 5]);
  assert.deepEqual(r.details.missing, ['09:31–09:33', '10:10', '10:59']);
  assert.equal(r.actual_candles + r.missing_candles, r.expected_candles);
});

test('every other minute (the AUD/USD pattern) is 45/90 with 45 single-minute gaps', () => {
  const r = assessSession(open, all.filter((_, i) => i % 2 === 0));
  assert.deepEqual([r.status, r.actual_candles, r.missing_candles, r.details.missing.length], ['incomplete', 45, 45, 45]);
  assert.equal(r.details.missing[0], '09:31');
});

test('no data on an open day; market closed with nothing stored', () => {
  const none = assessSession(open, []);
  assert.deepEqual([none.status, none.actual_candles, none.missing_candles, none.first_candle], ['no_data', 0, 90, null]);
  assert.equal(none.details.missing, undefined, 'a day with no data does not list 90 minutes');
  const sat = assessSession(sessionFor(SPY, '2025-10-11'), []);
  assert.deepEqual([sat.status, sat.expected_candles, sat.missing_candles, sat.details.closedReason], ['market_closed', 0, 0, 'weekend']);
  const hol = assessSession(sessionFor(SPY, '2025-11-27'), []);
  assert.equal(hol.details.closedReason, 'holiday: Thanksgiving Day');
});

test('candles on a closed day are invalid timestamps (gold on a Saturday) — reported, not dropped', () => {
  const sat = sessionFor(XAU, '2025-09-27');
  const r = assessSession(sat, expectedMinutes({ ...sat, open: true }).slice(0, 29).map((t) => c(t)));
  assert.deepEqual([r.status, r.expected_candles, r.actual_candles, r.invalid_timestamp_candles], ['invalid', 0, 29, 29]);
  assert.equal(r.details.invalidTimestamps[0].reason, 'MARKET_CLOSED');
  assert.equal(r.details.closedReason, 'weekend');
});

test('duplicates and invalid OHLC make the session invalid; candles outside the window are ignored', () => {
  const r = assessSession(open, [...all, all[5], c('2025-10-10T13:40:30.000Z'), c('2025-10-10T20:00:00.000Z')]);
  assert.deepEqual([r.status, r.duplicate_candles, r.invalid_timestamp_candles, r.actual_candles], ['invalid', 1, 1, 90]);
  assert.equal(r.details.invalidTimestamps[0].reason, 'NOT_ON_MINUTE');
  const bad = assessSession(open, all.map((x, i) => (i === 7 ? { ...x, high: '9' } : x)));
  assert.deepEqual([bad.status, bad.invalid_ohlc_candles, bad.details.invalidOhlc[0].reason], ['invalid', 1, 'HIGH_NOT_HIGHEST']);
});

test('missingRangesLocal groups consecutive minutes', () => {
  const t = (m) => Date.parse('2026-01-15T14:30:00Z') + m * 60_000; // 09:30 EST
  assert.deepEqual(missingRangesLocal([t(0), t(1), t(5), t(7), t(8), t(9)], 'America/New_York'), ['09:30–09:31', '09:35', '09:37–09:39']);
  assert.deepEqual(missingRangesLocal([], 'America/New_York'), []);
});

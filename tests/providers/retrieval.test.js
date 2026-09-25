import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_KEYS,
  RejectReason,
  Truncation,
  assessCompleteness,
  buildRetrievalResult,
  defineCapabilities,
  defineRange,
  defineRequest,
  rangeContains,
  remainingRange,
  splitRange,
  unverified,
  verified,
} from '../../supabase/functions/_shared/providers/mod.js';

const SYMBOL = Object.freeze({ symbol: 'TEST', provider: 'fake_provider', providerSymbol: 'TST' });
const caps = (facts = {}) =>
  defineCapabilities({
    providerId: 'fake_provider',
    facts: { ...Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, unverified()])), ...facts },
  });
const req = (start, end) => defineRequest({ symbol: SYMBOL, range: defineRange(start, end) });
const bar = (t) => ({ timestamp: t, open: '1', high: '1', low: '1', close: '1', volume: '1' });

// ---------------------------------------------------------------- ranges
test('ranges are half-open, UTC, whole-minute, and non-empty', () => {
  const r = defineRange('2026-07-01T09:30:00-04:00', '2026-07-01T11:00:00-04:00');
  assert.deepEqual(r, { startUtc: '2026-07-01T13:30:00.000Z', endUtc: '2026-07-01T15:00:00.000Z', minutes: 90 });
  assert.equal(rangeContains(r, '2026-07-01T13:30:00.000Z'), true);
  assert.equal(rangeContains(r, '2026-07-01T14:59:00.000Z'), true);
  assert.equal(rangeContains(r, '2026-07-01T15:00:00.000Z'), false); // end excluded
  assert.throws(() => defineRange('2026-07-01T13:30:00Z', '2026-07-01T13:30:00Z'), /after start/);
  assert.throws(() => defineRange('2026-07-01T13:31:00Z', '2026-07-01T13:30:00Z'), /after start/);
  assert.throws(() => defineRange('2026-07-01 09:30', '2026-07-01T13:30:00Z'), /TIMESTAMP_WITHOUT_TIMEZONE/);
  assert.throws(() => defineRange('2026-07-01T13:30:10Z', '2026-07-01T14:00:00Z'), /NOT_MINUTE_ALIGNED/);
});

test('splitRange halves on a minute boundary and covers the whole range', () => {
  const [a, b] = splitRange(defineRange('2026-07-01T13:30:00Z', '2026-07-01T13:35:00Z'));
  assert.equal(a.startUtc, '2026-07-01T13:30:00.000Z');
  assert.equal(a.endUtc, b.startUtc);
  assert.equal(b.endUtc, '2026-07-01T13:35:00.000Z');
  assert.equal(a.minutes + b.minutes, 5);
  assert.throws(() => splitRange(defineRange('2026-07-01T13:30:00Z', '2026-07-01T13:31:00Z')), /cannot be split/);
});

test('requests are 1-minute only and need a resolved symbol and a defined range', () => {
  const range = defineRange('2026-07-01T13:30:00Z', '2026-07-01T13:40:00Z');
  assert.throws(() => defineRequest({ symbol: SYMBOL, range, interval: '5min' }), /Only 1-minute/);
  assert.throws(() => defineRequest({ symbol: { symbol: 'X' }, range }), /resolveSymbol/);
  assert.throws(() => defineRequest({ symbol: SYMBOL, range: { startUtc: 'x' } }), /defineRange/);
});

// ---------------------------------------------------------------- results
test('buildRetrievalResult: counts, covered span, out-of-range rows rejected (not dropped)', () => {
  const request = req('2026-07-01T13:30:00Z', '2026-07-01T13:35:00Z');
  const result = buildRetrievalResult({
    request,
    rows: [bar('2026-07-01T13:31:00Z'), bar('2026-07-01T13:30:00Z'), bar('2026-07-01T13:35:00Z'), bar('nope')],
    truncation: Truncation.NONE,
  });
  assert.equal(result.receivedCount, 4);
  assert.deepEqual(result.candles.map((c) => c.timestampUtc), ['2026-07-01T13:30:00.000Z', '2026-07-01T13:31:00.000Z']);
  assert.deepEqual(result.coveredRange, { first: '2026-07-01T13:30:00.000Z', last: '2026-07-01T13:31:00.000Z' });
  assert.deepEqual(result.rejected.map((r) => r.reason).sort(), [RejectReason.INVALID_TIMESTAMP, RejectReason.OUTSIDE_REQUESTED_RANGE].sort());
  assert.equal(result.candles.length + result.rejected.length, result.receivedCount);
  assert.equal(result.provider, 'fake_provider');
  assert.equal(result.providerSymbol, 'TST');
});

test('buildRetrievalResult: empty answer has no covered range; secrets redacted from notes and rows', () => {
  const secret = 's' + 'ecret_' + 'z'.repeat(20);
  const request = req('2026-07-04T13:30:00Z', '2026-07-04T13:40:00Z');
  const empty = buildRetrievalResult({ request, rows: [], truncation: Truncation.NONE, providerNotes: [`used ${secret}`], secrets: [secret] });
  assert.equal(empty.coveredRange, null);
  assert.equal(empty.receivedCount, 0);
  assert.ok(!JSON.stringify(empty).includes(secret));
  const withBadRow = buildRetrievalResult({ request, rows: [{ timestamp: secret }], truncation: Truncation.NONE, secrets: [secret] });
  assert.ok(!JSON.stringify(withBadRow).includes(secret));
  assert.throws(() => buildRetrievalResult({ request, rows: [], truncation: 'maybe' }), /truncation must be/);
});

// ---------------------------------------------------------------- completeness (§6)
const complete = (truncation, start = '2026-07-01T13:30:00Z', end = '2026-07-01T13:40:00Z', rows = [bar(start)]) =>
  buildRetrievalResult({ request: req(start, end), rows, truncation });

test('detected truncation is always "truncated"', () => {
  assert.equal(assessCompleteness(complete(Truncation.DETECTED), caps()).state, 'truncated');
  const allVerified = caps({ truncationSignal: verified('explicit', 's'), maxSafeRangeMinutes: verified(1000, 's') });
  assert.equal(assessCompleteness(complete(Truncation.DETECTED), allVerified).state, 'truncated');
});

test('"none" is trusted only when the explicit truncation signal is VERIFIED', () => {
  assert.equal(assessCompleteness(complete(Truncation.NONE), caps()).state, 'undetermined');
  assert.equal(assessCompleteness(complete(Truncation.NONE), caps({ truncationSignal: verified('none', 's') })).state, 'undetermined');
  assert.equal(assessCompleteness(complete(Truncation.NONE), caps({ truncationSignal: verified('explicit', 's') })).state, 'answered');
});

test('"unknown" is answered only when the range fits a VERIFIED safe size', () => {
  const r10 = complete(Truncation.UNKNOWN); // 10-minute range
  assert.equal(assessCompleteness(r10, caps()).state, 'undetermined');
  assert.equal(assessCompleteness(r10, caps({ maxSafeRangeMinutes: { verified: false, value: 1000 } })).state, 'undetermined');
  assert.equal(assessCompleteness(r10, caps({ maxSafeRangeMinutes: verified(9, 's') })).state, 'undetermined');
  assert.equal(assessCompleteness(r10, caps({ maxSafeRangeMinutes: verified(10, 's') })).state, 'answered');
});

test('an answered empty range is flagged empty (recorded as a fact, not interpreted)', () => {
  const r = complete(Truncation.NONE, '2026-07-04T13:30:00Z', '2026-07-04T13:40:00Z', []);
  const a = assessCompleteness(r, caps({ truncationSignal: verified('explicit', 's') }));
  assert.equal(a.state, 'answered');
  assert.equal(a.empty, true);
  assert.doesNotMatch(a.reason, /holiday|closed|weekend/i);
});

// ---------------------------------------------------------------- remainder (§6 rule 3)
test('remainder for ascending results overlaps the last candle and never skips', () => {
  const r = buildRetrievalResult({
    request: req('2026-07-02T13:30:00Z', '2026-07-02T14:30:00Z'),
    rows: [bar('2026-07-02T13:30:00Z'), bar('2026-07-02T13:31:00Z')],
    truncation: Truncation.DETECTED,
  });
  const rest = remainingRange(r, caps({ resultOrder: verified('ascending', 's') }));
  assert.deepEqual(rest, { startUtc: '2026-07-02T13:31:00.000Z', endUtc: '2026-07-02T14:30:00.000Z', minutes: 59 });
});

test('remainder for descending results overlaps the first candle and never skips', () => {
  const r = buildRetrievalResult({
    request: req('2026-07-02T13:30:00Z', '2026-07-02T14:30:00Z'),
    rows: [bar('2026-07-02T14:29:00Z'), bar('2026-07-02T14:28:00Z')],
    truncation: Truncation.DETECTED,
  });
  const rest = remainingRange(r, caps({ resultOrder: verified('descending', 's') }));
  assert.deepEqual(rest, { startUtc: '2026-07-02T13:30:00.000Z', endUtc: '2026-07-02T14:29:00.000Z', minutes: 59 });
});

test('remainder needs a VERIFIED result order', () => {
  const r = complete(Truncation.DETECTED);
  assert.throws(() => remainingRange(r, caps()), /not verified/);
});

test('no progress possible → null, so the caller splits instead of looping forever', () => {
  const asc = caps({ resultOrder: verified('ascending', 's') });
  const onlyFirst = complete(Truncation.DETECTED, '2026-07-02T13:30:00Z', '2026-07-02T14:30:00Z', [bar('2026-07-02T13:30:00Z')]);
  assert.equal(remainingRange(onlyFirst, asc), null);
  const nothing = complete(Truncation.DETECTED, '2026-07-02T13:30:00Z', '2026-07-02T14:30:00Z', []);
  assert.equal(remainingRange(nothing, asc), null);
  const desc = caps({ resultOrder: verified('descending', 's') });
  const onlyLast = complete(Truncation.DETECTED, '2026-07-02T13:30:00Z', '2026-07-02T14:30:00Z', [bar('2026-07-02T14:29:00Z')]);
  assert.equal(remainingRange(onlyLast, desc), null);
});

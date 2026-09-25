/** Live-check helpers (TASK 007): dates, DST, probes and report — no network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProbes, describe, previousSaturday, previousWeekday, zonedToUtc } from '../scripts/live-check.mjs';

test('zonedToUtc follows US daylight saving without fixed offsets', () => {
  assert.equal(zonedToUtc('2026-07-01', '09:30', 'America/New_York'), '2026-07-01T13:30:00.000Z'); // EDT
  assert.equal(zonedToUtc('2026-01-15', '09:30', 'America/New_York'), '2026-01-15T14:30:00.000Z'); // EST
  assert.equal(zonedToUtc('2026-03-09', '09:30', 'America/New_York'), '2026-03-09T13:30:00.000Z'); // day after spring change
  assert.equal(zonedToUtc('2026-11-02', '11:00', 'America/New_York'), '2026-11-02T16:00:00.000Z'); // day after fall change
});

test('previousWeekday skips weekends and today; previousSaturday', () => {
  assert.equal(previousWeekday(Date.parse('2026-09-28T15:00:00Z')), '2026-09-25'); // Monday → Friday
  assert.equal(previousWeekday(Date.parse('2026-09-25T15:00:00Z')), '2026-09-24'); // Friday → Thursday
  assert.equal(previousSaturday(Date.parse('2026-09-25T15:00:00Z')), '2026-09-19');
});

test('probes: 90-minute US window, the four markets, a weekend probe', () => {
  const probes = buildProbes(Date.parse('2026-09-25T15:00:00Z'));
  assert.deepEqual(probes.map((p) => p.body.symbol), ['SPY', 'EUR/USD', 'BTC/USD', 'XAU/USD', 'SPY']);
  const us = probes[0].body;
  assert.equal((Date.parse(us.endUtc) - Date.parse(us.startUtc)) / 60_000, 90);
  assert.equal(us.startUtc, '2026-09-24T13:30:00.000Z');
});

test('report shows counts, volume and the end-boundary finding; errors show code and wait', () => {
  const ok = describe({ id: 'x', question: 'q', body: {} }, 200, {
    ok: true,
    completeness: { state: 'answered' },
    result: {
      receivedCount: 3,
      requestedRange: { minutes: 2, endUtc: '2026-07-01T13:32:00.000Z' },
      candles: [{ timestampUtc: '2026-07-01T13:30:00.000Z', volume: '5' }, { timestampUtc: '2026-07-01T13:31:00.000Z', volume: null }],
      rejected: [{ reason: 'OUTSIDE_REQUESTED_RANGE', raw: { timestampUtc: '2026-07-01T13:32:00.000Z' } }],
      coveredRange: { first: '2026-07-01T13:30:00.000Z', last: '2026-07-01T13:31:00.000Z' },
      truncation: 'unknown',
      providerNotes: ['api-credits-left=7'],
    },
  });
  assert.match(ok, /Candles with volume \| 1 of 2/);
  assert.match(ok, /range end returned \| yes/);
  const err = describe({ id: 'g', question: 'q', body: {} }, 502, { ok: false, error: { code: 'PLAN_RESTRICTED', message: 'Grow plan', retryPolicy: 'needs_human' } });
  assert.match(err, /PLAN_RESTRICTED/);
});

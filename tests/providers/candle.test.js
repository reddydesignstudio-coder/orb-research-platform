import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RejectReason,
  normalizeCandle,
  normalizeCandles,
  toDecimalString,
  toUtcMinute,
} from '../../supabase/functions/_shared/providers/mod.js';

const P = { provider: 'fake_provider' };
const row = (over = {}) => ({ timestamp: '2026-07-01T13:30:00Z', open: '1.1', high: '1.2', low: '1.0', close: '1.15', volume: '10', ...over });

test('a valid row normalizes to the DATABASE.md candle fields', () => {
  const r = normalizeCandle(row(), P);
  assert.equal(r.ok, true);
  assert.deepEqual(r.candle, {
    timestampUtc: '2026-07-01T13:30:00.000Z',
    open: '1.1',
    high: '1.2',
    low: '1.0',
    close: '1.15',
    volume: '10',
    provider: 'fake_provider',
    interval: '1min',
  });
  assert.ok(Object.isFrozen(r.candle));
});

test('explicit offsets convert to UTC across US daylight-saving changes', () => {
  // EDT (UTC-4) and EST (UTC-5): both 09:30 New York.
  assert.equal(toUtcMinute('2026-07-01T09:30:00-04:00').iso, '2026-07-01T13:30:00.000Z');
  assert.equal(toUtcMinute('2026-01-05T09:30:00-05:00').iso, '2026-01-05T14:30:00.000Z');
  // Around the 2026-03-08 spring-forward change.
  assert.equal(toUtcMinute('2026-03-06T09:30:00-05:00').iso, '2026-03-06T14:30:00.000Z');
  assert.equal(toUtcMinute('2026-03-09T09:30:00-04:00').iso, '2026-03-09T13:30:00.000Z');
  // Around the 2026-11-01 fall-back change.
  assert.equal(toUtcMinute('2026-10-30T09:30:00-04:00').iso, '2026-10-30T13:30:00.000Z');
  assert.equal(toUtcMinute('2026-11-02T09:30:00-05:00').iso, '2026-11-02T14:30:00.000Z');
  assert.equal(toUtcMinute(new Date('2026-07-01T13:30:00Z')).iso, '2026-07-01T13:30:00.000Z');
});

test('timestamps without a timezone are rejected, never guessed', () => {
  for (const t of ['2026-07-01 09:30:00', '2026-07-01T09:30:00', '2026-07-01T09:30']) {
    const r = normalizeCandle(row({ timestamp: t }), P);
    assert.equal(r.ok, false, t);
    assert.equal(r.reason, RejectReason.TIMESTAMP_WITHOUT_TIMEZONE, t);
  }
  assert.equal(normalizeCandle(row({ timestamp: 'yesterday' }), P).reason, RejectReason.INVALID_TIMESTAMP);
  assert.equal(normalizeCandle(row({ timestamp: 1782912600000 }), P).reason, RejectReason.INVALID_TIMESTAMP);
});

test('timestamps must fall on a whole minute', () => {
  const r = normalizeCandle(row({ timestamp: '2026-07-01T13:30:30Z' }), P);
  assert.equal(r.reason, RejectReason.TIMESTAMP_NOT_MINUTE_ALIGNED);
});

test('prices keep full precision as exact decimal strings', () => {
  const r = normalizeCandle(row({ open: '1.123456789012345678901', close: '0.00001' }), P);
  assert.equal(r.candle.open, '1.123456789012345678901');
  assert.equal(r.candle.close, '0.00001');
  assert.equal(toDecimalString(12.5), '12.5');
  assert.equal(toDecimalString(' 7 '), '7');
});

test('invalid decimals are rejected: negative, exponent, NaN, text, empty', () => {
  for (const bad of ['-1', '1e-7', 1e-7, NaN, Infinity, 'abc', '1,5', '.5', '01.5']) {
    assert.equal(toDecimalString(bad), null, String(bad));
  }
  assert.equal(normalizeCandle(row({ high: '-1' }), P).reason, RejectReason.INVALID_DECIMAL);
  assert.equal(normalizeCandle(row({ close: '' }), P).reason, RejectReason.MISSING_FIELD);
});

test('missing volume stays null — never turned into zero; a provider-sent 0 stays "0"', () => {
  assert.equal(normalizeCandle(row({ volume: null }), P).candle.volume, null);
  assert.equal(normalizeCandle(row({ volume: undefined }), P).candle.volume, null);
  assert.equal(normalizeCandle(row({ volume: '' }), P).candle.volume, null);
  assert.equal(normalizeCandle(row({ volume: '0' }), P).candle.volume, '0');
  assert.equal(normalizeCandle(row({ volume: 'n/a' }), P).reason, RejectReason.INVALID_DECIMAL);
});

test('missing fields are rejected with the field name', () => {
  for (const f of ['timestamp', 'open', 'high', 'low', 'close']) {
    const r = normalizeCandle(row({ [f]: undefined }), P);
    assert.equal(r.ok, false);
    assert.equal(r.field, f);
    assert.equal(r.reason, RejectReason.MISSING_FIELD);
  }
  assert.equal(normalizeCandle(null, P).reason, RejectReason.MISSING_FIELD);
});

test('normalization does not judge price relationships (that is the Validate step)', () => {
  // high < low is syntactically valid here; validation happens later (ARCHITECTURE.md §5).
  assert.equal(normalizeCandle(row({ high: '0.5', low: '2' }), P).ok, true);
});

test('batch: sorted ascending, rejections kept with reason and raw row, nothing dropped', () => {
  const rows = [
    row({ timestamp: '2026-07-01T13:32:00Z' }),
    row({ timestamp: 'bad' }),
    row({ timestamp: '2026-07-01T13:30:00Z' }),
    row({ timestamp: '2026-07-01T13:30:00Z' }), // duplicate kept; dedup is a later step
  ];
  const { candles, rejected } = normalizeCandles(rows, P);
  assert.deepEqual(candles.map((c) => c.timestampUtc), [
    '2026-07-01T13:30:00.000Z',
    '2026-07-01T13:30:00.000Z',
    '2026-07-01T13:32:00.000Z',
  ]);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].raw.timestamp, 'bad');
  assert.equal(candles.length + rejected.length, rows.length);
});

test('provider id must be valid', () => {
  assert.throws(() => normalizeCandle(row(), { provider: 'Twelve Data' }), /Invalid provider id/);
});

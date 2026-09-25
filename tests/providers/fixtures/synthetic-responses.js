/**
 * SYNTHETIC provider responses for contract tests (PROVIDERS.md §15).
 *
 * The format below is invented for tests and deliberately resembles no real
 * provider: rows are { t, o, h, l, c, v } with an explicit UTC offset in `t`,
 * and the response carries { more: boolean | undefined } as its truncation flag.
 * Nothing here describes Twelve Data or any other provider.
 *
 * Keyed by the requested range start (UTC).
 */

// US daylight time (EDT, UTC-4): 09:30 New York = 13:30Z.
export const RESPONSES = Object.freeze({
  // A normal, complete response with an explicit "no more data" signal.
  '2026-07-01T13:30:00.000Z': {
    more: false,
    rows: [
      { t: '2026-07-01T09:30:00-04:00', o: '100.10', h: '100.50', l: '100.00', c: '100.40', v: '1200' },
      { t: '2026-07-01T09:31:00-04:00', o: '100.40', h: '100.60', l: '100.30', c: '100.55', v: '900' },
      { t: '2026-07-01T09:32:00-04:00', o: '100.55', h: '100.70', l: '100.50', c: '100.65', v: null },
    ],
  },
  // Provider answered but returned nothing for the range (a fact; not interpreted).
  '2026-07-04T13:30:00.000Z': { more: false, rows: [] },
  // Truncated page: provider says more data exists in the same range.
  '2026-07-02T13:30:00.000Z': {
    more: true,
    rows: [
      { t: '2026-07-02T09:30:00-04:00', o: '101', h: '101.2', l: '100.9', c: '101.1', v: '10' },
      { t: '2026-07-02T09:31:00-04:00', o: '101.1', h: '101.3', l: '101.0', c: '101.2', v: '11' },
    ],
  },
  // Mixed: invalid rows must be rejected with a reason, valid rows kept.
  '2026-07-03T13:30:00.000Z': {
    more: false,
    rows: [
      { t: '2026-07-03T09:30:00-04:00', o: '102', h: '102.5', l: '101.5', c: '102.2', v: '5' },
      { t: '2026-07-03T09:31:00', o: '102', h: '102.5', l: '101.5', c: '102.2', v: '5' }, // no timezone
      { t: '2026-07-03T09:32:30-04:00', o: '102', h: '102.5', l: '101.5', c: '102.2', v: '5' }, // not whole minute
      { t: '2026-07-03T09:33:00-04:00', o: 'abc', h: '102.5', l: '101.5', c: '102.2', v: '5' }, // bad price
      { t: '2026-07-03T09:34:00-04:00', o: '102.2', h: '102.6', l: '102.1', c: '102.4', v: '7' },
      { t: '2026-07-03T08:00:00-04:00', o: '99', h: '99', l: '99', c: '99', v: '1' }, // outside the range
    ],
  },
  // Provider response with unknown truncation state (flag absent).
  '2026-07-06T13:30:00.000Z': {
    rows: [{ t: '2026-07-06T09:30:00-04:00', o: '103', h: '103', l: '103', c: '103', v: '1' }],
  },
  // Failures, expressed in the synthetic format.
  '2026-07-07T13:30:00.000Z': { failure: { status: 401, message: 'bad credentials' } },
  '2026-07-08T13:30:00.000Z': { failure: { status: 429, message: 'slow down', retryAfterSeconds: 30 } },
  '2026-07-09T13:30:00.000Z': { failure: { status: 503, message: 'maintenance' } },
  '2026-07-10T13:30:00.000Z': { failure: { status: 404, message: 'unknown symbol' } },
  '2026-07-13T13:30:00.000Z': { malformed: '<html>not json</html>' },
});

/** Scenarios for checkProviderContract(): what the fake provider must produce. */
export const SCENARIOS = Object.freeze([
  { name: 'complete page', range: ['2026-07-01T13:30:00Z', '2026-07-01T13:40:00Z'], expect: 'ok', candles: 3, rejected: 0, truncation: 'none' },
  { name: 'empty answer', range: ['2026-07-04T13:30:00Z', '2026-07-04T13:40:00Z'], expect: 'ok', candles: 0, rejected: 0, truncation: 'none' },
  { name: 'truncated page', range: ['2026-07-02T13:30:00Z', '2026-07-02T14:30:00Z'], expect: 'ok', candles: 2, rejected: 0, truncation: 'detected' },
  { name: 'invalid rows', range: ['2026-07-03T13:30:00Z', '2026-07-03T13:40:00Z'], expect: 'ok', candles: 2, rejected: 4, truncation: 'none' },
  { name: 'unknown truncation', range: ['2026-07-06T13:30:00Z', '2026-07-06T13:40:00Z'], expect: 'ok', candles: 1, truncation: 'unknown' },
  { name: 'auth failure', range: ['2026-07-07T13:30:00Z', '2026-07-07T13:40:00Z'], expect: 'error', errorCode: 'AUTH_FAILED' },
  { name: 'rate limited', range: ['2026-07-08T13:30:00Z', '2026-07-08T13:40:00Z'], expect: 'error', errorCode: 'RATE_LIMITED' },
  { name: 'provider down', range: ['2026-07-09T13:30:00Z', '2026-07-09T13:40:00Z'], expect: 'error', errorCode: 'PROVIDER_UNAVAILABLE' },
  { name: 'unknown symbol', range: ['2026-07-10T13:30:00Z', '2026-07-10T13:40:00Z'], expect: 'error', errorCode: 'SYMBOL_NOT_FOUND' },
  { name: 'malformed response', range: ['2026-07-13T13:30:00Z', '2026-07-13T13:40:00Z'], expect: 'error', errorCode: 'MALFORMED_RESPONSE' },
]);

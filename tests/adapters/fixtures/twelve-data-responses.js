/**
 * SYNTHETIC Twelve Data responses (TASK 006).
 *
 * Written by hand in the response format documented at twelvedata.com/docs
 * (checked 2026-09-25): { meta, values: [{ datetime, open, high, low, close,
 * volume }], status } and errors { code, message, status: "error" }.
 * They are NOT recordings of the live API — prices are invented. The live
 * check (PROVIDERS.md §15) compares the real format against these.
 *
 * Keyed by the request's start_date (UTC, as sent by the adapter).
 */

const meta = (symbol, extra = {}) => ({
  symbol,
  interval: '1min',
  currency: 'USD',
  exchange_timezone: 'UTC',
  exchange: 'TEST',
  type: 'Common Stock',
  ...extra,
});

const bar = (datetime, o, h, l, c, volume) => ({ datetime, open: o, high: h, low: l, close: c, ...(volume === undefined ? {} : { volume }) });

/** 5000 consecutive bars from 2026-07-06 00:00 UTC (a full page). */
function fullPage() {
  const out = [];
  const start = Date.parse('2026-07-06T00:00:00Z');
  for (let i = 0; i < 5000; i++) {
    const d = new Date(start + i * 60_000).toISOString();
    out.push(bar(`${d.slice(0, 10)} ${d.slice(11, 19)}`, '1.1', '1.2', '1.0', '1.15', '1'));
  }
  return out;
}

export const TD_RESPONSES = Object.freeze({
  // Summer (EDT): 09:30 New York = 13:30 UTC. Twelve Data returns UTC because timezone=UTC was sent.
  '2026-07-01T13:30:00': {
    status: 200,
    headers: { 'api-credits-used': '1', 'api-credits-left': '7' },
    body: {
      meta: meta('SPY'),
      values: [
        bar('2026-07-01 13:30:00', '545.12000', '545.50000', '545.01000', '545.40000', '120000'),
        bar('2026-07-01 13:31:00', '545.40000', '545.61000', '545.30000', '545.55000', '90000'),
        bar('2026-07-01 13:32:00', '545.55000', '545.70000', '545.50000', '545.65000', '85000'),
      ],
      status: 'ok',
    },
  },
  // Winter (EST): 09:30 New York = 14:30 UTC.
  '2026-01-15T14:30:00': {
    status: 200,
    body: { meta: meta('SPY'), values: [bar('2026-01-15 14:30:00', '500.1', '500.2', '500.0', '500.15', '1000')], status: 'ok' },
  },
  // Provider includes the bar AT end_date (inclusive end): it belongs to the next range.
  '2026-07-02T13:30:00': {
    status: 200,
    body: {
      meta: meta('SPY'),
      values: [
        bar('2026-07-02 13:30:00', '1', '1', '1', '1', '1'),
        bar('2026-07-02 13:31:00', '1', '1', '1', '1', '1'),
        bar('2026-07-02 13:32:00', '1', '1', '1', '1', '1'), // = range end → rejected, not stored
      ],
      status: 'ok',
    },
  },
  // Invalid rows are rejected with a reason; valid rows kept.
  '2026-07-03T13:30:00': {
    status: 200,
    body: {
      meta: meta('SPY'),
      values: [
        bar('2026-07-03 13:30:00', '10', '11', '9', '10.5', '5'),
        bar('2026-07-03 13:31:00', 'abc', '11', '9', '10.5', '5'),
        bar('07/03/2026 13:32', '10', '11', '9', '10.5', '5'),
        bar('2026-07-03 13:33:00', '10', '11', '9', '10.5', '5'),
      ],
      status: 'ok',
    },
  },
  // Answered with no candles, in the (unverified) wording Twelve Data is expected to use.
  '2026-07-04T13:30:00': {
    status: 200,
    body: { code: 400, message: 'No data is available on the specified dates. Try setting different start/end dates.', status: 'error' },
  },
  // status ok, empty values.
  '2026-07-05T13:30:00': { status: 200, body: { meta: meta('SPY'), values: [], status: 'ok' } },
  // A full page: truncation cannot be ruled out.
  '2026-07-06T00:00:00': { status: 200, body: { meta: meta('SPY'), values: fullPage(), status: 'ok' } },

  // ---- errors
  '2026-08-01T13:30:00': { status: 401, body: { code: 401, message: '**apikey** parameter is incorrect or not specified.', status: 'error' } },
  '2026-08-02T13:30:00': { status: 200, body: { code: 403, message: 'This symbol is available starting with the Grow plan.', status: 'error' } },
  '2026-08-03T13:30:00': { status: 200, body: { code: 404, message: 'Requested data could not be found.', status: 'error' } },
  '2026-08-04T13:30:00': { status: 429, body: { code: 429, message: 'You have run out of API credits for the current minute.', status: 'error' } },
  '2026-08-05T13:30:00': { status: 429, body: { code: 429, message: 'You have run out of API credits for the day.', status: 'error' } },
  '2026-08-06T13:30:00': { status: 500, body: { code: 500, message: 'Internal error', status: 'error' } },
  '2026-08-07T13:30:00': { status: 502, raw: '<html>Bad gateway</html>' },
  '2026-08-08T13:30:00': { status: 200, raw: 'not json' },
  '2026-08-09T13:30:00': { status: 200, body: { meta: meta('SPY.X'), values: [], status: 'ok' } }, // different instrument
  '2026-08-10T13:30:00': { status: 200, body: { code: 400, message: '**symbol** not found: SPY. Please specify it correctly.', status: 'error' } },
  '2026-08-11T13:30:00': { status: 200, body: { meta: meta('SPY'), values: 'nope', status: 'ok' } },
  '2026-08-12T13:30:00': { status: 429, headers: { 'retry-after': '90' }, body: { code: 429, message: 'Too many requests', status: 'error' } },
  '2026-08-13T13:30:00': { throws: 'network' },
  '2026-08-14T13:30:00': { throws: 'timeout' },
});

/** Forex: no volume field in the rows. */
export const TD_FOREX = Object.freeze({
  '2026-07-01T13:30:00': {
    status: 200,
    body: {
      meta: meta('EUR/USD', { type: 'Physical Currency', currency_base: 'Euro', currency_quote: 'US Dollar' }),
      values: [bar('2026-07-01 13:30:00', '1.08512', '1.08530', '1.08500', '1.08525'), bar('2026-07-01 13:31:00', '1.08525', '1.08540', '1.08520', '1.08535')],
      status: 'ok',
    },
  },
});

/** Contract scenarios (tests/providers/provider-contract.js) for the SPY fixtures. */
export const TD_SCENARIOS = Object.freeze([
  { name: 'complete US response (EDT)', range: ['2026-07-01T13:30:00Z', '2026-07-01T13:33:00Z'], expect: 'ok', candles: 3, rejected: 0, truncation: 'unknown' },
  { name: 'complete US response (EST)', range: ['2026-01-15T14:30:00Z', '2026-01-15T14:31:00Z'], expect: 'ok', candles: 1, rejected: 0 },
  { name: 'inclusive end boundary', range: ['2026-07-02T13:30:00Z', '2026-07-02T13:32:00Z'], expect: 'ok', candles: 2, rejected: 1 },
  { name: 'invalid rows', range: ['2026-07-03T13:30:00Z', '2026-07-03T13:40:00Z'], expect: 'ok', candles: 2, rejected: 2 },
  { name: 'no data message', range: ['2026-07-04T13:30:00Z', '2026-07-04T13:40:00Z'], expect: 'ok', candles: 0, rejected: 0 },
  { name: 'empty values', range: ['2026-07-05T13:30:00Z', '2026-07-05T13:40:00Z'], expect: 'ok', candles: 0, rejected: 0 },
  { name: 'full page', range: ['2026-07-06T00:00:00Z', '2026-07-10T00:00:00Z'], expect: 'ok', candles: 5000, truncation: 'detected' },
  { name: '401', range: ['2026-08-01T13:30:00Z', '2026-08-01T13:40:00Z'], expect: 'error', errorCode: 'AUTH_FAILED' },
  { name: '403 in body', range: ['2026-08-02T13:30:00Z', '2026-08-02T13:40:00Z'], expect: 'error', errorCode: 'PLAN_RESTRICTED' },
  { name: '404', range: ['2026-08-03T13:30:00Z', '2026-08-03T13:40:00Z'], expect: 'error', errorCode: 'SYMBOL_NOT_FOUND' },
  { name: '429 minute', range: ['2026-08-04T13:30:00Z', '2026-08-04T13:40:00Z'], expect: 'error', errorCode: 'RATE_LIMITED' },
  { name: '429 daily', range: ['2026-08-05T13:30:00Z', '2026-08-05T13:40:00Z'], expect: 'error', errorCode: 'QUOTA_EXHAUSTED' },
  { name: '500', range: ['2026-08-06T13:30:00Z', '2026-08-06T13:40:00Z'], expect: 'error', errorCode: 'PROVIDER_UNAVAILABLE' },
  { name: '502 html', range: ['2026-08-07T13:30:00Z', '2026-08-07T13:40:00Z'], expect: 'error', errorCode: 'PROVIDER_UNAVAILABLE' },
  { name: 'not json', range: ['2026-08-08T13:30:00Z', '2026-08-08T13:40:00Z'], expect: 'error', errorCode: 'MALFORMED_RESPONSE' },
  { name: 'different instrument', range: ['2026-08-09T13:30:00Z', '2026-08-09T13:40:00Z'], expect: 'error', errorCode: 'MALFORMED_RESPONSE' },
  { name: 'symbol not found (400)', range: ['2026-08-10T13:30:00Z', '2026-08-10T13:40:00Z'], expect: 'error', errorCode: 'SYMBOL_NOT_FOUND' },
  { name: 'values not an array', range: ['2026-08-11T13:30:00Z', '2026-08-11T13:40:00Z'], expect: 'error', errorCode: 'MALFORMED_RESPONSE' },
  { name: 'network failure', range: ['2026-08-13T13:30:00Z', '2026-08-13T13:40:00Z'], expect: 'error', errorCode: 'NETWORK_ERROR' },
  { name: 'timeout', range: ['2026-08-14T13:30:00Z', '2026-08-14T13:40:00Z'], expect: 'error', errorCode: 'TIMEOUT' },
]);

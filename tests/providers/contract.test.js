/**
 * The shared provider contract (PROVIDERS.md §15), exercised against a fixture-
 * driven fake provider — and against deliberately broken providers, to prove the
 * contract checker actually catches violations. No live provider is called.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProviderContract } from './provider-contract.js';
import { createFakeProvider, FAKE_ID } from './fixtures/fake-provider.js';
import { SCENARIOS } from './fixtures/synthetic-responses.js';
import {
  ProviderError,
  Truncation,
  assessCompleteness,
  buildRetrievalResult,
  defineRange,
  defineRequest,
  verified,
} from '../../supabase/functions/_shared/providers/mod.js';

// A fake credential assembled at runtime (no credential-shaped literal in the repo).
const FAKE_KEY = ['fk', 'test', 'abcdefghijklmnop0123'].join('_');
const SYMBOL = Object.freeze({ symbol: 'SPY', provider: FAKE_ID, provider_symbol: 'SPY', market: 'us_stock' });

const run = (provider, scenarios = SCENARIOS) =>
  checkProviderContract({ provider, symbolConfig: SYMBOL, scenarios, secrets: [FAKE_KEY] });

test('the fixture-driven fake provider satisfies the whole contract', async () => {
  const violations = await run(createFakeProvider({ apiKey: FAKE_KEY }));
  assert.deepEqual(violations, []);
});

test('fake provider: provider-signalled wait is carried on RATE_LIMITED', async () => {
  const p = createFakeProvider({ apiKey: FAKE_KEY });
  const request = defineRequest({ symbol: p.resolveSymbol(SYMBOL), range: defineRange('2026-07-08T13:30:00Z', '2026-07-08T13:40:00Z') });
  await assert.rejects(p.fetchCandles(request), (e) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.code, 'RATE_LIMITED');
    assert.equal(e.retryAfterMs, 30_000);
    assert.ok(!e.message.includes(FAKE_KEY));
    return true;
  });
});

test('fake provider end-to-end: truncated page → remainder; complete page → answered', async () => {
  const p = createFakeProvider({ apiKey: FAKE_KEY });
  const caps = p.capabilities();
  const resolved = p.resolveSymbol(SYMBOL);
  const truncated = await p.fetchCandles(defineRequest({ symbol: resolved, range: defineRange('2026-07-02T13:30:00Z', '2026-07-02T14:30:00Z') }));
  assert.equal(assessCompleteness(truncated, caps).state, 'truncated');
  const done = await p.fetchCandles(defineRequest({ symbol: resolved, range: defineRange('2026-07-01T13:30:00Z', '2026-07-01T13:40:00Z') }));
  assert.equal(assessCompleteness(done, caps).state, 'answered');
  const unknown = await p.fetchCandles(defineRequest({ symbol: resolved, range: defineRange('2026-07-06T13:30:00Z', '2026-07-06T13:40:00Z') }));
  assert.equal(assessCompleteness(unknown, caps).state, 'undetermined'); // maxSafeRangeMinutes is unverified in the fake
});

// ------------------------------------------------ the checker catches violations
test('contract catches a provider that rewrites the symbol', async () => {
  const base = createFakeProvider({ apiKey: FAKE_KEY });
  const bad = { ...base, resolveSymbol: (c) => ({ symbol: c.symbol, provider: FAKE_ID, providerSymbol: c.provider_symbol.toLowerCase() + '.US' }) };
  const v = await run(bad);
  assert.ok(v.some((x) => /resolveSymbol changed/.test(x)), v.join('\n'));
  assert.ok(v.some((x) => /another provider/.test(x)), v.join('\n'));
});

test('contract catches a provider that leaks the API key', async () => {
  const base = createFakeProvider({ apiKey: FAKE_KEY });
  const bad = {
    ...base,
    async fetchCandles(request) {
      const r = await base.fetchCandles(request);
      return { ...r, providerNotes: [`GET https://api.invalid/?key=${FAKE_KEY}`] };
    },
  };
  const v = await run(bad, SCENARIOS.filter((s) => s.expect === 'ok'));
  assert.ok(v.some((x) => /secret leaked/.test(x)), v.join('\n'));
});

test('contract catches silently dropped rows and out-of-order / out-of-range candles', async () => {
  const base = createFakeProvider({ apiKey: FAKE_KEY });
  const bad = {
    ...base,
    async fetchCandles(request) {
      const r = await base.fetchCandles(request);
      const outside = { ...r.candles[0], timestampUtc: '2020-01-01T00:00:00.000Z' };
      return { ...r, rejected: [], candles: r.candles.length ? [...r.candles].reverse().concat(outside) : r.candles };
    },
  };
  const v = await run(bad, SCENARIOS.filter((s) => s.name === 'invalid rows'));
  assert.ok(v.some((x) => /silently dropped/.test(x)), v.join('\n'));
  assert.ok(v.some((x) => /ascending/.test(x)), v.join('\n'));
  assert.ok(v.some((x) => /outside requested range/.test(x)), v.join('\n'));
});

test('contract catches a provider that fabricates missing volume as zero', async () => {
  const base = createFakeProvider({ apiKey: FAKE_KEY });
  const bad = {
    ...base,
    async fetchCandles(request) {
      const r = await base.fetchCandles(request);
      return { ...r, candles: r.candles.map((c) => ({ ...c, volume: c.volume ?? 0 })) };
    },
  };
  const v = await run(bad, SCENARIOS.filter((s) => s.name === 'complete page'));
  assert.ok(v.some((x) => /volume must be a decimal string or null/.test(x)), v.join('\n'));
});

test('contract catches plain errors, wrong error codes and invented success', async () => {
  const base = createFakeProvider({ apiKey: FAKE_KEY });
  const throwsPlain = { ...base, fetchCandles: async () => { throw new Error('oops'); } };
  const v1 = await run(throwsPlain, SCENARIOS.filter((s) => s.name === 'auth failure'));
  assert.ok(v1.some((x) => /not a ProviderError/.test(x)), v1.join('\n'));

  const inventsData = {
    ...base,
    async fetchCandles(request) {
      return buildRetrievalResult({ request, rows: [], truncation: Truncation.NONE });
    },
  };
  const v2 = await run(inventsData, SCENARIOS.filter((s) => s.name === 'provider down'));
  assert.ok(v2.some((x) => /expected error PROVIDER_UNAVAILABLE, got a result/.test(x)), v2.join('\n'));
});

test('contract catches a provider that claims capabilities for a different id', async () => {
  const base = createFakeProvider({ apiKey: FAKE_KEY });
  const bad = { ...base, capabilities: () => ({ ...base.capabilities(), providerId: 'someone_else' }) };
  const v = await run(bad, []);
  assert.ok(v.some((x) => /providerId does not match/.test(x)), v.join('\n'));
});

test('the fake provider becomes "answered" for unknown truncation only once a safe size is verified', async () => {
  const p = createFakeProvider({ apiKey: FAKE_KEY, facts: { maxSafeRangeMinutes: verified(10, 'synthetic fixture') } });
  const r = await p.fetchCandles(defineRequest({ symbol: p.resolveSymbol(SYMBOL), range: defineRange('2026-07-06T13:30:00Z', '2026-07-06T13:40:00Z') }));
  assert.equal(assessCompleteness(r, p.capabilities()).state, 'answered');
});

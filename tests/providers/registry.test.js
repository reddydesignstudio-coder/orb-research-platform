import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderMismatchError,
  ProviderNotRegisteredError,
  assertMarketDataProvider,
  createProviderRegistry,
  resolveSymbolExactly,
} from '../../supabase/functions/_shared/providers/mod.js';
import { createFakeProvider, FAKE_ID } from './fixtures/fake-provider.js';

test('assertMarketDataProvider lists every missing member', () => {
  assert.throws(() => assertMarketDataProvider({ id: 'p' }), (e) => {
    for (const m of ['displayName', 'capabilities', 'resolveSymbol', 'fetchCandles', 'classifyError']) {
      assert.match(e.message, new RegExp(m));
    }
    return true;
  });
  assert.throws(() => assertMarketDataProvider({ ...createFakeProvider(), id: 'Twelve Data' }), /"id" must match/);
  assert.throws(() => assertMarketDataProvider(null), /must be an object/);
});

test('resolveSymbolExactly returns provider_symbol unchanged and refuses other providers', () => {
  const cfg = { symbol: 'EUR/USD', provider: 'p', provider_symbol: ' eur/usd ' };
  assert.deepEqual(resolveSymbolExactly('p', cfg), { symbol: 'EUR/USD', provider: 'p', providerSymbol: ' eur/usd ' });
  assert.throws(() => resolveSymbolExactly('p', { ...cfg, provider: 'q' }), ProviderMismatchError);
  assert.throws(() => resolveSymbolExactly('p', { ...cfg, provider_symbol: '' }), /no provider_symbol/);
  assert.throws(() => resolveSymbolExactly('p', { provider: 'p', provider_symbol: 'X' }), /needs "symbol"/);
});

test('the registry serves a symbol only from its configured provider — no fallback', () => {
  const registry = createProviderRegistry([createFakeProvider()]);
  assert.deepEqual(registry.ids(), [FAKE_ID]);
  assert.equal(registry.forSymbol({ symbol: 'SPY', provider: FAKE_ID }).id, FAKE_ID);
  assert.throws(() => registry.forSymbol({ symbol: 'SPY', provider: 'other_provider' }), ProviderNotRegisteredError);
  assert.throws(() => registry.forSymbol({ symbol: 'SPY' }), ProviderNotRegisteredError);
  assert.throws(() => registry.get('other_provider'), /will not be imported from any other provider/);
});

test('an empty registry has no default provider', () => {
  assert.throws(() => createProviderRegistry([]).forSymbol({ symbol: 'SPY', provider: FAKE_ID }), ProviderNotRegisteredError);
});

test('duplicate or invalid adapters are refused at registration', () => {
  assert.throws(() => createProviderRegistry([createFakeProvider(), createFakeProvider()]), /Duplicate provider id/);
  assert.throws(() => createProviderRegistry([{ id: 'x' }]), /Invalid MarketDataProvider/);
});

/**
 * Provider registry: the only way the importer obtains an adapter
 * (PROVIDERS.md §14 — no silent provider switching).
 *
 * A symbol is served ONLY by the provider named in its configuration
 * (symbols.provider). There is no fallback, no "try the next provider", and no
 * default provider: an unregistered provider is an error that must be shown.
 */

import { assertMarketDataProvider } from './provider.js';

export class ProviderNotRegisteredError extends Error {
  constructor(providerId, symbol) {
    super(
      `No adapter is registered for provider "${providerId}"` +
        (symbol ? ` (needed by symbol "${symbol}")` : '') +
        '. The symbol will not be imported from any other provider (PROVIDERS.md §14).',
    );
    this.name = 'ProviderNotRegisteredError';
    this.providerId = providerId;
  }
}

/**
 * @param {object[]} adapters  MarketDataProvider objects
 */
export function createProviderRegistry(adapters = []) {
  /** @type {Map<string, object>} */
  const byId = new Map();
  for (const adapter of adapters) {
    assertMarketDataProvider(adapter);
    if (byId.has(adapter.id)) throw new TypeError(`Duplicate provider id "${adapter.id}"`);
    byId.set(adapter.id, adapter);
  }

  return Object.freeze({
    /** @returns {string[]} */
    ids: () => [...byId.keys()],

    /** @param {string} providerId */
    get(providerId) {
      const adapter = byId.get(providerId);
      if (!adapter) throw new ProviderNotRegisteredError(providerId);
      return adapter;
    },

    /**
     * The adapter for a configured symbol — exactly symbols.provider, nothing else.
     * @param {{ symbol: string, provider: string }} symbolConfig
     */
    forSymbol(symbolConfig) {
      const adapter = byId.get(symbolConfig?.provider);
      if (!adapter) throw new ProviderNotRegisteredError(symbolConfig?.provider, symbolConfig?.symbol);
      return adapter;
    },
  });
}

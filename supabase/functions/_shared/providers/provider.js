/**
 * The MarketDataProvider abstraction (PROVIDERS.md §1, §1.1, §5).
 *
 * JavaScript has no interfaces, so the contract is:
 *   1. the typedef below (documentation for adapter authors), and
 *   2. assertMarketDataProvider(), which checks an adapter at registration time.
 *
 * Every adapter (the first in TASK 006; further providers later, see ARCHITECTURE.md §4)
 * is a plain object or class instance with these members:
 *
 *   id                string   stable provider identifier, stored as the
 *                              provider on candles and import jobs
 *   displayName       string   name shown in Admin
 *   capabilities()    → value of defineCapabilities()           (§11)
 *   resolveSymbol(symbolConfig) → ResolvedSymbol                  (§5)
 *   fetchCandles(request)  → Promise<RetrievalResult>             (§1.1, §6)
 *                            one explicit UTC range, one response;
 *                            throws ProviderError on failure
 *   classifyError(error)   → ProviderError                        (§10)
 *
 * Adapters never write to the database, never switch provider, and never read
 * secrets from anywhere but the environment they are given (Edge Function
 * secrets) — see §13, §14.
 */

import { PROVIDER_ID_PATTERN } from './candle.js';

/**
 * @typedef {object} SymbolConfig    a row from the symbols table (DATABASE.md)
 * @property {string} symbol
 * @property {string} provider
 * @property {string} provider_symbol
 * @property {string} [market]
 */

/**
 * @typedef {object} ResolvedSymbol
 * @property {string} symbol          the project's symbol
 * @property {string} provider        adapter id (must equal SymbolConfig.provider)
 * @property {string} providerSymbol  exactly SymbolConfig.provider_symbol
 */

export const REQUIRED_MEMBERS = Object.freeze({
  id: 'string',
  displayName: 'string',
  capabilities: 'function',
  resolveSymbol: 'function',
  fetchCandles: 'function',
  classifyError: 'function',
});

/** Thrown when a symbol is handed to the wrong provider — a configuration error. */
export class ProviderMismatchError extends Error {
  constructor(expected, actual, symbol) {
    super(
      `Symbol "${symbol}" is configured for provider "${actual}", not "${expected}". ` +
        'Providers are never switched automatically (PROVIDERS.md §14).',
    );
    this.name = 'ProviderMismatchError';
  }
}

/**
 * Check that an object satisfies the MarketDataProvider contract. Throws with
 * every problem listed. Returns the provider for chaining.
 * @template P
 * @param {P} provider
 * @returns {P}
 */
export function assertMarketDataProvider(provider) {
  const problems = [];
  if (!provider || typeof provider !== 'object') {
    throw new TypeError('A MarketDataProvider must be an object');
  }
  for (const [member, type] of Object.entries(REQUIRED_MEMBERS)) {
    if (typeof provider[member] !== type) problems.push(`"${member}" must be a ${type}`);
  }
  if (typeof provider.id === 'string' && !PROVIDER_ID_PATTERN.test(provider.id)) {
    problems.push(`"id" must match ${PROVIDER_ID_PATTERN} (got "${provider.id}")`);
  }
  if (problems.length) throw new TypeError(`Invalid MarketDataProvider: ${problems.join('; ')}`);
  return provider;
}

/**
 * The provider-neutral symbol resolution every adapter uses (§5):
 * the provider symbol is returned EXACTLY as configured — no guessing,
 * rewriting or substitution. Adapters may add checks (e.g. reject a format
 * their provider cannot accept) but must not change the value.
 * @param {string} providerId
 * @param {SymbolConfig} config
 * @returns {ResolvedSymbol}
 */
export function resolveSymbolExactly(providerId, config) {
  if (!config || typeof config !== 'object') throw new TypeError('symbol config is required');
  const { symbol, provider, provider_symbol: providerSymbol } = config;
  if (typeof symbol !== 'string' || symbol.trim() === '') throw new TypeError('symbol config needs "symbol"');
  if (provider !== providerId) throw new ProviderMismatchError(providerId, provider, symbol);
  if (typeof providerSymbol !== 'string' || providerSymbol.trim() === '') {
    throw new TypeError(`Symbol "${symbol}" has no provider_symbol configured`);
  }
  return Object.freeze({ symbol, provider: providerId, providerSymbol });
}

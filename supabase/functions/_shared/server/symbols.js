/**
 * Load a configured symbol and build its configured provider (PROVIDERS.md §5, §14).
 * Shared by the market-data and importer functions. Never guesses a symbol and
 * never falls back to another provider.
 */

import { createProviderRegistry } from '../providers/mod.js';
import { createTwelveDataProvider } from '../adapters/twelve_data/mod.js';
import { PROVIDER_SETTINGS } from '../market-data/config.js';
import { RestError } from './rest.js';

/** Names of every provider secret, so callers can redact their values. */
export const providerSecretNames = () => Object.values(PROVIDER_SETTINGS).map((s) => s.secretName);

/**
 * @returns {Promise<{ ok: true, config: object, provider: object } | { ok: false, status: number, code: string, message: string }>}
 */
export async function loadSymbolWithProvider({ rest, env, fetchImpl, now, symbol }) {
  let rows;
  try {
    rows = await rest.select('symbols', { symbol: `eq.${symbol}`, select: 'id,symbol,market,provider,provider_symbol,enabled' });
  } catch (e) {
    if (e instanceof RestError) return { ok: false, status: 502, code: 'DATABASE_ERROR', message: `Reading symbols failed: ${e.message}` };
    throw e;
  }
  const config = Array.isArray(rows) ? rows[0] : undefined;
  if (!config) return { ok: false, status: 404, code: 'SYMBOL_NOT_CONFIGURED', message: `"${symbol}" is not in the symbols table.` };
  if (!config.enabled) return { ok: false, status: 409, code: 'SYMBOL_DISABLED', message: `"${symbol}" is disabled.` };

  const settings = PROVIDER_SETTINGS[config.provider];
  if (!settings) return { ok: false, status: 422, code: 'PROVIDER_NOT_REGISTERED', message: `No adapter for provider "${config.provider}".` };

  const adapters = [];
  if (config.provider === 'twelve_data') {
    adapters.push(createTwelveDataProvider({ apiKey: env(settings.secretName) ?? '', plan: settings.plan, fetchImpl, now }));
  }
  return { ok: true, config, provider: createProviderRegistry(adapters).forSymbol(config) };
}

/**
 * market-data Edge Function — request handler (TASK 007, ARCHITECTURE.md §2–§5).
 *
 * The only place a provider is called. One request = one provider call for one
 * configured symbol and one explicit UTC range. It stores nothing: storing,
 * checkpointing and pacing belong to the importer (TASK 008–012).
 *
 *   POST /functions/v1/market-data
 *   apikey: <a Supabase SECRET key>          server-to-server only (D-020)
 *   { "symbol": "SPY", "startUtc": "…Z", "endUtc": "…Z" }
 *
 * → 200 { ok: true,  symbol, provider, completeness, result }
 * → 4xx/5xx { ok: false, error: { code, message, retryPolicy?, retryAfterMs? } }
 *
 * Security (PROVIDERS.md §13):
 *   - callers must present a Supabase secret key (SUPABASE_SECRET_KEYS, provided
 *     by Supabase to every function); no browser can call this function;
 *   - the provider key is read from the function's secrets at request time and
 *     passed to the adapter; it never appears in responses or logs;
 *   - no CORS headers are sent, so browsers cannot read responses.
 *
 * Plain JS with injected env/fetch so it runs in Deno and is tested in Node.
 */

import {
  ProviderError,
  ProviderNotRegisteredError,
  assessCompleteness,
  createProviderRegistry,
  defineRange,
  defineRequest,
  redactSecrets,
} from '../providers/mod.js';
import { createTwelveDataProvider } from '../adapters/twelve_data/mod.js';
import { PROVIDER_SETTINGS } from './config.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** Read the named secret keys Supabase provides as a JSON object. */
export function parseSecretKeys(raw) {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    return Object.values(obj ?? {}).filter((v) => typeof v === 'string' && v.length >= 16);
  } catch {
    return [];
  }
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const failure = (status, code, message, extra = {}) => reply(status, { ok: false, error: { code, message, ...extra } });

/**
 * @param {object} deps
 * @param {(name: string) => string | undefined} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @param {(msg: string) => void} [deps.log]
 */
export function createMarketDataHandler({ env, fetchImpl = globalThis.fetch, now = Date.now, log = console.error }) {
  return async function handle(req) {
    const secretKeys = parseSecretKeys(env('SUPABASE_SECRET_KEYS'));
    const providerKeys = Object.values(PROVIDER_SETTINGS).map((s) => env(s.secretName)).filter(Boolean);
    const allSecrets = [...secretKeys, ...providerKeys];
    const redact = (text) => redactSecrets(text, allSecrets);

    try {
      if (req.method !== 'POST') return failure(405, 'METHOD_NOT_ALLOWED', 'Use POST.');

      // ---- caller authorization: Supabase secret key only (server-to-server)
      if (secretKeys.length === 0) {
        return failure(500, 'SERVER_MISCONFIGURED', 'SUPABASE_SECRET_KEYS is not available to the function.');
      }
      const presented = req.headers.get('apikey') ?? '';
      if (!secretKeys.some((k) => safeEqual(k, presented))) {
        return failure(401, 'UNAUTHORIZED', 'A Supabase secret key is required in the apikey header.');
      }

      // ---- input
      let body;
      try {
        body = await req.json();
      } catch {
        return failure(400, 'BAD_REQUEST', 'Body must be JSON: { symbol, startUtc, endUtc }.');
      }
      const { symbol, startUtc, endUtc } = body ?? {};
      if (typeof symbol !== 'string' || symbol.trim() === '') return failure(400, 'BAD_REQUEST', '"symbol" is required.');
      let range;
      try {
        range = defineRange(startUtc, endUtc);
      } catch (e) {
        return failure(400, 'BAD_REQUEST', e.message);
      }

      // ---- configured symbol (DATABASE.md — symbols); never guessed
      const baseUrl = env('SUPABASE_URL');
      if (!baseUrl) return failure(500, 'SERVER_MISCONFIGURED', 'SUPABASE_URL is not available to the function.');
      const q = new URLSearchParams({ symbol: `eq.${symbol}`, select: 'symbol,market,provider,provider_symbol,enabled' });
      let dbRes;
      try {
        dbRes = await fetchImpl(`${baseUrl}/rest/v1/symbols?${q}`, {
          headers: { apikey: secretKeys[0], accept: 'application/json' },
        });
      } catch (e) {
        return failure(502, 'DATABASE_ERROR', `Reading symbols failed: ${redact(e?.message ?? e)}`);
      }
      if (!dbRes.ok) return failure(502, 'DATABASE_ERROR', `Reading symbols failed (HTTP ${dbRes.status}).`);
      const rows = await dbRes.json();
      const config = Array.isArray(rows) ? rows[0] : undefined;
      if (!config) return failure(404, 'SYMBOL_NOT_CONFIGURED', `"${symbol}" is not in the symbols table.`);
      if (!config.enabled) return failure(409, 'SYMBOL_DISABLED', `"${symbol}" is disabled.`);

      // ---- the symbol's configured provider only (PROVIDERS.md §14)
      const settings = PROVIDER_SETTINGS[config.provider];
      if (!settings) return failure(422, 'PROVIDER_NOT_REGISTERED', `No adapter for provider "${config.provider}".`);
      const adapters = [];
      if (config.provider === 'twelve_data') {
        adapters.push(createTwelveDataProvider({ apiKey: env(settings.secretName) ?? '', plan: settings.plan, fetchImpl, now }));
      }
      const provider = createProviderRegistry(adapters).forSymbol(config);

      const request = defineRequest({ symbol: provider.resolveSymbol(config), range });
      const result = await provider.fetchCandles(request);
      const completeness = assessCompleteness(result, provider.capabilities());

      return reply(200, { ok: true, symbol: config.symbol, market: config.market, provider: provider.id, completeness, result });
    } catch (e) {
      if (e instanceof ProviderError) {
        const status = e.code === 'RATE_LIMITED' || e.code === 'QUOTA_EXHAUSTED' ? 429 : 502;
        return failure(status, e.code, redact(e.message), {
          provider: e.providerId,
          retryPolicy: e.retryPolicy,
          ...(e.retryAfterMs !== undefined ? { retryAfterMs: e.retryAfterMs } : {}),
        });
      }
      if (e instanceof ProviderNotRegisteredError) return failure(422, 'PROVIDER_NOT_REGISTERED', redact(e.message));
      log(`market-data: unexpected error: ${redact(e?.stack ?? e)}`);
      return failure(500, 'INTERNAL_ERROR', redact(e?.message ?? String(e)));
    }
  };
}

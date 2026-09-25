/**
 * Twelve Data adapter — historical 1-minute candles (TASK 006, PROVIDERS.md §3).
 *
 * One call to fetchCandles() = one time_series request for one symbol and one
 * explicit UTC range. The adapter never writes to the database, never retries,
 * never paginates on its own and never switches provider: those decisions stay
 * with the importer (TASK 008–012), which uses the shared helpers
 * assessCompleteness() / splitRange().
 *
 * Request (all documented at twelvedata.com/docs, checked 2026-09-25):
 *   GET https://api.twelvedata.com/time_series
 *   Authorization: apikey <key>        header — the key is never put in the URL
 *   symbol=<provider_symbol exactly>   interval=1min
 *   start_date / end_date              range in UTC ("YYYY-MM-DDTHH:MM:SS"); end_date is
 *                                      inclusive, so it is the range's last bar
 *   timezone=UTC                       output datetimes and date params in UTC
 *   order=asc   outputsize=5000        (page size)
 *   adjust=none                        raw prices: stored candles are immutable,
 *                                      so they must not change after a later split
 *                                      (owner decision, D-018)
 *
 * The API key is passed in by the caller (the Edge Function reads it from its
 * secrets in TASK 007). This module never reads environment variables.
 */

import {
  ProviderError,
  ProviderErrorCode,
  Truncation,
  buildRetrievalResult,
  classifyGenericError,
  resolveSymbolExactly,
} from '../../providers/mod.js';
import { MAX_SAFE_RANGE_MINUTES, PAGE_SIZE, SUPPORTED_PLANS, TWELVE_DATA_ID, twelveDataCapabilities } from './capabilities.js';
import { mapTwelveDataError, parseRetryAfter } from './errors.js';

export const BASE_URL = 'https://api.twelvedata.com';
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Datetime format in time_series values when timezone=UTC is sent: "2026-07-01 13:30:00". */
const TD_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/;

/** ISO UTC "2026-07-01T13:30:00.000Z" → "2026-07-01T13:30:00" (interpreted as UTC via timezone=UTC). */
const toTdDate = (isoUtc) => isoUtc.slice(0, 19);

/**
 * end_date is INCLUSIVE (live check 2026-09-25, D-021), so the last bar of a
 * half-open [start, end) range is requested as end − 1 minute.
 */
const lastBarOf = (range) => new Date(Date.parse(range.endUtc) - 60_000).toISOString();

/**
 * The adapter asked for UTC, so a bare "YYYY-MM-DD HH:MM:SS" is a UTC instant.
 * Anything else is passed through unchanged, so shared normalization rejects
 * it with a reason instead of the adapter guessing.
 */
export function tdDatetimeToUtc(value) {
  const m = typeof value === 'string' ? TD_DATETIME.exec(value.trim()) : null;
  return m ? `${m[1]}T${m[2]}Z` : value;
}

/** Build the request URL. Contains no secret. */
export function buildTimeSeriesUrl(request, baseUrl = BASE_URL) {
  const q = new URLSearchParams({
    symbol: request.symbol.providerSymbol,
    interval: '1min',
    start_date: toTdDate(request.range.startUtc),
    end_date: toTdDate(lastBarOf(request.range)),
    timezone: 'UTC',
    order: 'asc',
    outputsize: String(PAGE_SIZE),
    adjust: 'none',
  });
  return `${baseUrl}/time_series?${q}`;
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey                from Edge Function secrets (never logged)
 * @param {string} opts.plan                  owner's plan, e.g. "basic"
 * @param {typeof fetch} [opts.fetchImpl]     injectable for tests
 * @param {() => number} [opts.now]           clock, injectable for tests
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.baseUrl]
 */
export function createTwelveDataProvider({ apiKey, plan, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = DEFAULT_TIMEOUT_MS, baseUrl = BASE_URL } = {}) {
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    throw new ProviderError({
      code: ProviderErrorCode.AUTH_FAILED,
      message: 'No Twelve Data API key configured. Add it as a Supabase Edge Function secret (never in source code).',
      providerId: TWELVE_DATA_ID,
    });
  }
  if (!SUPPORTED_PLANS.includes(plan)) {
    throw new TypeError(`Unverified Twelve Data plan "${plan}". Verified plans: ${SUPPORTED_PLANS.join(', ')} (PROVIDERS.md §3).`);
  }
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch is not available');

  const secrets = [apiKey];
  const caps = twelveDataCapabilities(plan);
  const fail = (code, message, detail) => new ProviderError({ code, message, providerId: TWELVE_DATA_ID, detail, secrets });

  async function send(url, signal) {
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await fetchImpl(url, { method: 'GET', headers: { Authorization: `apikey ${apiKey}`, Accept: 'application/json' }, signal: combined });
    } catch (error) {
      throw classifyGenericError(error, TWELVE_DATA_ID, secrets);
    }
  }

  async function readJson(response) {
    const text = await response.text().catch((e) => {
      throw classifyGenericError(e, TWELVE_DATA_ID, secrets);
    });
    try {
      return JSON.parse(text);
    } catch {
      if (!response.ok) return null; // e.g. an HTML error page — classified by HTTP status below
      throw fail(ProviderErrorCode.MALFORMED_RESPONSE, 'Twelve Data response is not JSON', { httpStatus: response.status });
    }
  }

  function creditNotes(response) {
    const used = response.headers?.get?.('api-credits-used');
    const left = response.headers?.get?.('api-credits-left');
    return used !== null && used !== undefined ? [`api-credits-used=${used}; api-credits-left=${left ?? '?'}`] : [];
  }

  return Object.freeze({
    id: TWELVE_DATA_ID,
    displayName: 'Twelve Data',
    capabilities: () => caps,
    resolveSymbol: (config) => resolveSymbolExactly(TWELVE_DATA_ID, config),
    classifyError: (error) => classifyGenericError(error, TWELVE_DATA_ID, secrets),

    /**
     * @param {import('../../providers/retrieval.js').CandleRequest} request
     * @returns {Promise<import('../../providers/retrieval.js').RetrievalResult>}
     */
    async fetchCandles(request) {
      if (request.symbol.provider !== TWELVE_DATA_ID) {
        throw new TypeError(`Request for provider "${request.symbol.provider}" sent to ${TWELVE_DATA_ID}`);
      }
      const url = buildTimeSeriesUrl(request, baseUrl);
      const response = await send(url, request.signal);
      const body = await readJson(response);
      const notes = creditNotes(response);

      const isError = !response.ok || body?.status === 'error';
      if (isError) {
        const code = Number.isInteger(body?.code) ? body.code : response.status;
        const error = mapTwelveDataError({
          code,
          message: typeof body?.message === 'string' ? body.message : '',
          nowMs: now(),
          retryAfterMs: parseRetryAfter(response.headers?.get?.('retry-after'), now()),
          secrets,
        });
        if (error.code !== ProviderErrorCode.NO_DATA_RETURNED) throw error;
        // The provider answered the range with no candles. Record its words; do not interpret (§12).
        return buildRetrievalResult({ request, rows: [], truncation: Truncation.UNKNOWN, providerNotes: [...notes, `Provider answered with no data: ${error.message}`], secrets });
      }

      if (body?.status !== 'ok' || !body.meta || typeof body.meta !== 'object') {
        throw fail(ProviderErrorCode.MALFORMED_RESPONSE, 'Twelve Data response has no status "ok" / meta', { httpStatus: response.status });
      }
      // Never accept a different instrument or interval than requested (§5, §14).
      if (body.meta.symbol !== request.symbol.providerSymbol || body.meta.interval !== '1min') {
        throw fail(
          ProviderErrorCode.MALFORMED_RESPONSE,
          `Twelve Data answered for "${body.meta.symbol}" / "${body.meta.interval}", requested "${request.symbol.providerSymbol}" / "1min"`,
        );
      }
      const values = body.values ?? [];
      if (!Array.isArray(values)) throw fail(ProviderErrorCode.MALFORMED_RESPONSE, 'Twelve Data "values" is not an array');

      const rows = values.map((v) => ({
        timestamp: tdDatetimeToUtc(v?.datetime),
        open: v?.open,
        high: v?.high,
        low: v?.low,
        close: v?.close,
        volume: v?.volume, // absent → null, never 0 (§2)
      }));

      // No "more data" signal exists (truncationSignal: none). A full page means
      // truncation cannot be ruled out, whatever the range size.
      const truncation = rows.length >= PAGE_SIZE ? Truncation.DETECTED : Truncation.UNKNOWN;
      if (truncation === Truncation.DETECTED) notes.push(`Full page (${PAGE_SIZE} rows): more data may exist in this range.`);
      if (request.range.minutes > MAX_SAFE_RANGE_MINUTES) {
        notes.push(`Range of ${request.range.minutes} min exceeds the safe size of ${MAX_SAFE_RANGE_MINUTES} min.`);
      }

      return buildRetrievalResult({ request, rows, truncation, providerNotes: notes, secrets });
    },
  });
}

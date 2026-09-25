/**
 * Twelve Data error mapping (PROVIDERS.md §10) — TASK 006.
 *
 * Documented (twelvedata.com/docs, 2026-09-25): errors are a JSON object with
 * `code`, `message` and `status` ("error"), and the codes 400, 401, 403, 404,
 * 414, 429, 500. The adapter reads the code from the body, and falls back to
 * the HTTP status.
 *
 * NOT documented, marked UNVERIFIED below and listed for the live check:
 *   - the wording of the "no data for these dates" message;
 *   - whether a 429 message distinguishes the daily limit from the minute limit.
 * When those patterns do not match, the error falls back to the safe category
 * (UNKNOWN → shown to the owner; RATE_LIMITED → retried next minute).
 */

import { ProviderError, ProviderErrorCode } from '../../providers/mod.js';
import { TWELVE_DATA_ID } from './capabilities.js';

// UNVERIFIED message patterns — confirm during the live check (PROVIDERS.md §15).
export const NO_DATA_MESSAGE = /no data is available/i;
export const DAILY_LIMIT_MESSAGE = /\b(daily|per day|for the day|today)\b/i;
export const SYMBOL_MESSAGE = /symbol.*(not found|invalid|missing)|(not found|invalid).*symbol/i;

const BY_CODE = Object.freeze({
  401: ProviderErrorCode.AUTH_FAILED, //   "Invalid or incorrect API key"
  403: ProviderErrorCode.PLAN_RESTRICTED, // "API key lacks permissions"
  404: ProviderErrorCode.SYMBOL_NOT_FOUND, // "Requested data could not be found"
  429: ProviderErrorCode.RATE_LIMITED, //  "API request limit reached"
  500: ProviderErrorCode.PROVIDER_UNAVAILABLE,
});

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** ms until the next clock minute (credits reset "every minute", CREDITS article). */
export const msToNextMinute = (nowMs) => MINUTE_MS - (nowMs % MINUTE_MS);
/** ms until 00:00:00 UTC (Basic daily limit reset, CREDITS article). */
export const msToUtcMidnight = (nowMs) => DAY_MS - (nowMs % DAY_MS);

/**
 * @param {object} p
 * @param {number} p.code          body code, or HTTP status when the body has none
 * @param {string} p.message       provider message (redacted by ProviderError)
 * @param {number} p.nowMs
 * @param {number} [p.retryAfterMs] from a Retry-After header, when present
 * @param {string[]} p.secrets
 * @returns {ProviderError}
 */
export function mapTwelveDataError({ code, message, nowMs, retryAfterMs, secrets }) {
  let errorCode = BY_CODE[code] ?? (code >= 500 ? ProviderErrorCode.PROVIDER_UNAVAILABLE : ProviderErrorCode.UNKNOWN);
  let wait;

  if (code === 400 && NO_DATA_MESSAGE.test(message)) errorCode = ProviderErrorCode.NO_DATA_RETURNED;
  else if ((code === 400 || code === 404) && SYMBOL_MESSAGE.test(message)) errorCode = ProviderErrorCode.SYMBOL_NOT_FOUND;

  if (errorCode === ProviderErrorCode.RATE_LIMITED) {
    if (DAILY_LIMIT_MESSAGE.test(message)) {
      errorCode = ProviderErrorCode.QUOTA_EXHAUSTED;
      wait = msToUtcMidnight(nowMs);
    } else {
      wait = msToNextMinute(nowMs);
    }
    if (Number.isFinite(retryAfterMs) && retryAfterMs > wait) wait = retryAfterMs; // honour the provider's wait
  }

  return new ProviderError({
    code: errorCode,
    message: `Twelve Data ${code}: ${message || '(no message)'}`,
    providerId: TWELVE_DATA_ID,
    retryAfterMs: wait,
    detail: { providerCode: code },
    secrets,
  });
}

/** Retry-After header → ms (seconds or HTTP date). Undefined when absent/invalid. */
export function parseRetryAfter(value, nowMs) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : undefined;
}

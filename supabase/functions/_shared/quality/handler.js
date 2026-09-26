/**
 * data-quality Edge Function — request handler (TASK 014, D-029).
 *
 *   POST /functions/v1/data-quality
 *   apikey: <a Supabase SECRET key>                      server-to-server only (D-020)
 *   { "pending": true, "perSymbol"?: 1–100 }                check sessions not yet checked
 *   { "symbol": "SPY", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }   re-check a range (to exclusive, ≤ 120 days)
 *
 * Reads stored candles and import jobs only; writes data_quality rows. No provider call.
 */

import { failure, guardServerRequest, parseSecretKeys, reply } from '../server/http.js';
import { createRestClient, RestError } from '../server/rest.js';
import { loadEnabledSymbols } from '../server/symbols.js';
import { createImportStore } from '../importer/store.js';
import { HISTORY_START_UTC } from '../importer/config.js';
import { addDays, parseDate } from '../sessions/calendar.js';
import { SessionError, sessionDateOf, sessionDefinition } from '../sessions/validator.js';
import { createQualityStore } from './store.js';
import { assessAndStore, countByStatus, pendingSessions, rangeSessions } from './run.js';

export const DEFAULT_PER_SYMBOL = 30;
export const MAX_PER_SYMBOL = 100;
export const MAX_RANGE_DAYS = 120;

function sessionProblem(symbol) {
  try {
    sessionDefinition(symbol);
    return null;
  } catch (e) {
    return { code: e instanceof SessionError ? e.code : 'SESSION_INVALID', message: e.message };
  }
}

function daysBetween(from, to) {
  let n = 0;
  for (let d = from; d < to && n <= MAX_RANGE_DAYS; d = addDays(d, 1)) n += 1;
  return n;
}

/**
 * @param {object} deps
 * @param {(name: string) => string | undefined} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @param {(msg: string) => void} [deps.log]
 * @param {string} [deps.historyStartUtc]
 */
export function createDataQualityHandler({ env, fetchImpl = globalThis.fetch, now = Date.now, log = console.error, historyStartUtc = HISTORY_START_UTC }) {
  return async function handle(req) {
    const secretKeys = parseSecretKeys(env('SUPABASE_SECRET_KEYS'));
    try {
      const refused = guardServerRequest(req, secretKeys);
      if (refused) return refused;
      let body;
      try {
        body = await req.json();
      } catch {
        return failure(400, 'BAD_REQUEST', 'Body must be JSON: { pending: true } or { symbol, from, to }.');
      }
      const pending = body?.pending === true;
      const { symbol: symbolName, from, to, perSymbol = DEFAULT_PER_SYMBOL } = body ?? {};
      if (pending && symbolName !== undefined) return failure(400, 'BAD_REQUEST', '"pending": true checks every enabled symbol: send no symbol.');
      if (!pending && (typeof symbolName !== 'string' || !symbolName.trim())) return failure(400, 'BAD_REQUEST', '"symbol" with "from"/"to" is required (or send "pending": true).');
      if (pending && (!Number.isInteger(perSymbol) || perSymbol < 1 || perSymbol > MAX_PER_SYMBOL)) {
        return failure(400, 'BAD_REQUEST', `perSymbol must be an integer from 1 to ${MAX_PER_SYMBOL}.`);
      }
      if (!pending) {
        try {
          parseDate(from);
          parseDate(to);
        } catch (e) {
          return failure(400, 'BAD_REQUEST', `from/to: ${e.message}`);
        }
        if (!(from < to)) return failure(400, 'BAD_REQUEST', '"to" must be after "from" (to is exclusive).');
        if (daysBetween(from, to) > MAX_RANGE_DAYS) return failure(400, 'BAD_REQUEST', `A range covers at most ${MAX_RANGE_DAYS} days.`);
      }

      const baseUrl = env('SUPABASE_URL');
      if (!baseUrl) return failure(500, 'SERVER_MISCONFIGURED', 'SUPABASE_URL is not available to the function.');
      const rest = createRestClient({ baseUrl, key: secretKeys[0], fetchImpl });
      const importStore = createImportStore(rest);
      const store = createQualityStore(rest);
      const nowMs = now();
      const nowIso = new Date(nowMs).toISOString();

      const symbols = await loadEnabledSymbols(rest);

      if (!pending) {
        const symbol = symbols.find((s) => s.symbol === symbolName.trim());
        if (!symbol) return failure(404, 'UNKNOWN_SYMBOL', `"${symbolName}" is not an enabled symbol.`);
        const problem = sessionProblem(symbol);
        if (problem) return failure(422, problem.code, problem.message);
        const answered = await importStore.answeredRanges(symbol.id, symbol.provider);
        const { sessions, notImported } = rangeSessions({ symbol, answered, fromDate: from, toDate: to });
        const rows = await assessAndStore({ symbol, sessions, store, nowIso });
        return reply(200, {
          ok: true, mode: 'range', symbol: symbol.symbol, from, to,
          checked: rows.length, byStatus: countByStatus(rows), notYetImported: notImported,
          sessions: rows.map(({ symbol_id, ...r }) => r),
        });
      }

      const perSymbolOut = [];
      const all = [];
      for (const symbol of symbols) {
        const problem = sessionProblem(symbol);
        if (problem) {
          perSymbolOut.push({ symbol: symbol.symbol, skipped: problem.code, message: problem.message });
          continue;
        }
        const [assessed, answered] = await Promise.all([store.assessedDates(symbol.id), importStore.answeredRanges(symbol.id, symbol.provider)]);
        const todayDate = sessionDateOf(symbol, nowIso);
        const { sessions, frontierDate, more } = pendingSessions({ symbol, assessed, answered, historyStartUtc, todayDate, limit: perSymbol });
        const rows = await assessAndStore({ symbol, sessions, store, nowIso });
        all.push(...rows);
        perSymbolOut.push({
          symbol: symbol.symbol,
          checked: rows.length,
          byStatus: countByStatus(rows),
          checkedThrough: rows.length ? rows.at(-1).session_date : null,
          waitingForImportFrom: frontierDate,
          more,
          problems: rows.filter((r) => r.status !== 'complete' && r.status !== 'market_closed')
            .map((r) => `${r.session_date} ${r.status} ${r.actual_candles}/${r.expected_candles}${r.details.missing ? ` missing ${r.details.missing.slice(0, 4).join(', ')}${r.details.missing.length > 4 ? ' …' : ''}` : ''}`),
        });
      }
      return reply(200, {
        ok: true, mode: 'pending', checkedAt: nowIso,
        checked: all.length, byStatus: countByStatus(all),
        more: perSymbolOut.some((p) => p.more),
        perSymbol: perSymbolOut,
      });
    } catch (e) {
      if (e instanceof RestError) {
        log(`data-quality: ${e.message}`);
        return failure(502, 'DATABASE_ERROR', e.message);
      }
      log(`data-quality: unexpected ${e?.stack ?? e}`);
      return failure(500, 'INTERNAL_ERROR', 'Unexpected error while checking data quality.');
    }
  };
}

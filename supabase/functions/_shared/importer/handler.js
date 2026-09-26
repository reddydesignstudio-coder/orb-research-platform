/**
 * importer Edge Function — request handler (TASK 008, 009, 011).
 *
 *   POST /functions/v1/importer
 *   apikey: <a Supabase SECRET key>             server-to-server only (D-020)
 *   { "balanced": true, "maxJobs"?: 1–7 }                              (TASK 011 — GET DATA)
 *   { "symbol": "SPY", "continue": true, "maxJobs"?: 1–7 }             (TASK 009)
 *   { "symbol": "SPY", "startUtc": "…Z", "endUtc": "…Z", "maxJobs"?: 1–7 }
 *
 * Every mode stores only candles inside the symbol's research window
 * (symbols.session_*; 09:30–11:00 America/New_York, D-025).
 *
 * Checkpointing / resume (TASK 009, D-023):
 *   - windows already definitively answered are never requested again;
 *   - jobs left "running" by an interrupted run are closed as INTERRUPTED first;
 *   - only minutes that ended at least SETTLE_MINUTES ago are imported.
 * Balanced (TASK 011, D-026): every enabled symbol is built from HISTORY_START_UTC;
 * each step imports one window for the symbol furthest behind (balance.js).
 */

import { ProviderError, defineRange, redactSecrets, requireVerified } from '../providers/mod.js';
import { failure, guardServerRequest, parseSecretKeys, reply } from '../server/http.js';
import { createRestClient } from '../server/rest.js';
import { loadEnabledSymbols, loadSymbolWithProvider, providerFor, providerSecretNames } from '../server/symbols.js';
import { providerFailure } from '../market-data/handler.js';
import { runImport } from './engine.js';
import { runBalanced } from './balance.js';
import { checkpointOf, mergeCoverage } from './coverage.js';
import { researchWindow } from './session.js';
import { createImportStore } from './store.js';
import { HISTORY_START_UTC } from './config.js';

export const DEFAULT_MAX_JOBS = 4;
/** Only minutes that ended at least this long ago are imported (D-023). */
export const SETTLE_MINUTES = 30;
/** A job still "running" this long after it started was interrupted (functions time out far sooner). */
export const INTERRUPTED_AFTER_MINUTES = 15;

const MINUTE_MS = 60_000;

/** maxJobs allowed by the plan's per-minute limit (pacing proper is TASK 012). */
function jobCap(provider) {
  return Math.max(1, requireVerified(provider.capabilities(), 'rateLimit').creditsPerMinute - 1);
}

function windowOrFailure(config) {
  try {
    const keep = researchWindow(config);
    if (!keep) return { error: { status: 422, code: 'SESSION_NOT_DEFINED', message: `"${config.symbol}" has no research window (session_start/session_end) configured.` } };
    return { keep };
  } catch (e) {
    return { error: { status: 422, code: 'SESSION_INVALID', message: e.message } };
  }
}

/**
 * @param {object} deps
 * @param {(name: string) => string | undefined} deps.env
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {() => number} [deps.now]
 * @param {() => string} [deps.newRunId]
 * @param {(msg: string) => void} [deps.log]
 * @param {string} [deps.historyStartUtc]   override for tests
 */
export function createImporterHandler({ env, fetchImpl = globalThis.fetch, now = Date.now, newRunId = () => crypto.randomUUID(), log = console.error, historyStartUtc = HISTORY_START_UTC }) {
  return async function handle(req) {
    const secretKeys = parseSecretKeys(env('SUPABASE_SECRET_KEYS'));
    const allSecrets = [...secretKeys, ...providerSecretNames().map((n) => env(n)).filter(Boolean)];
    const redact = (text) => redactSecrets(text, allSecrets);

    try {
      const refused = guardServerRequest(req, secretKeys);
      if (refused) return refused;

      let body;
      try {
        body = await req.json();
      } catch {
        return failure(400, 'BAD_REQUEST', 'Body must be JSON: { balanced: true } or { symbol, continue: true } or { symbol, startUtc, endUtc }.');
      }
      const { symbol, startUtc, endUtc, maxJobs = DEFAULT_MAX_JOBS } = body ?? {};
      const balanced = body?.balanced === true;
      const continuing = body?.continue === true;
      const nowMs = now();
      const nowIso = new Date(nowMs).toISOString();
      const settledIso = new Date(Math.floor(nowMs / MINUTE_MS) * MINUTE_MS - SETTLE_MINUTES * MINUTE_MS).toISOString();
      const staleIso = new Date(nowMs - INTERRUPTED_AFTER_MINUTES * MINUTE_MS).toISOString();

      if (balanced && (symbol !== undefined || continuing || startUtc !== undefined || endUtc !== undefined)) {
        return failure(400, 'BAD_REQUEST', '"balanced": true imports every enabled symbol: send no symbol, dates or "continue".');
      }
      if (!balanced && (typeof symbol !== 'string' || symbol.trim() === '')) return failure(400, 'BAD_REQUEST', '"symbol" is required (or send "balanced": true).');

      let explicitRange = null;
      if (!balanced && !continuing) {
        try {
          explicitRange = defineRange(startUtc, endUtc);
        } catch (e) {
          return failure(400, 'BAD_REQUEST', `${e.message} (or send "continue": true)`);
        }
        if (explicitRange.endUtc > settledIso) {
          return failure(400, 'BAD_REQUEST', `endUtc must be at or before ${settledIso}: only minutes that ended at least ${SETTLE_MINUTES} minutes ago are imported.`);
        }
      } else if (continuing && (startUtc !== undefined || endUtc !== undefined)) {
        return failure(400, 'BAD_REQUEST', 'Send either "continue": true or startUtc/endUtc, not both.');
      }

      const baseUrl = env('SUPABASE_URL');
      if (!baseUrl) return failure(500, 'SERVER_MISCONFIGURED', 'SUPABASE_URL is not available to the function.');
      const rest = createRestClient({ baseUrl, key: secretKeys[0], fetchImpl });
      const store = createImportStore(rest);

      // ------------------------------------------------------------ balanced (GET DATA)
      if (balanced) {
        const rows = await loadEnabledSymbols(rest);
        const ready = [];
        const notReady = [];
        let cap = Infinity;
        for (const config of rows) {
          const built = providerFor(config, { env, fetchImpl, now });
          if (!built.ok) { notReady.push({ symbol: config.symbol, symbolId: config.id, setAside: built.code, message: built.message }); continue; }
          const w = windowOrFailure(config);
          if (w.error) { notReady.push({ symbol: config.symbol, symbolId: config.id, setAside: w.error.code, message: w.error.message }); continue; }
          cap = Math.min(cap, jobCap(built.provider));
          ready.push({ config, provider: built.provider, keep: w.keep });
        }
        if (!ready.length) return failure(409, 'NOTHING_TO_IMPORT', 'No enabled symbol is ready to import.', { notReady });
        if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > cap) {
          return failure(400, 'BAD_REQUEST', `"maxJobs" must be an integer from 1 to ${cap} for this provider plan.`);
        }
        let interruptedJobsClosed = 0;
        for (const s of ready) {
          interruptedJobsClosed += await store.closeInterruptedJobs(s.config.id, staleIso, nowIso);
          s.answered = await store.answeredRanges(s.config.id, s.provider.id);
        }
        const summary = await runBalanced({
          runId: newRunId(),
          symbols: ready,
          historyStartIso: historyStartUtc,
          settledIso,
          maxJobs,
          store,
          now,
          secrets: allSecrets,
        });
        let progressError = null;
        try {
          for (const p of summary.perSymbol) {
            if (p.inserted > 0) await store.refreshProgress(p.symbolId, ready.find((r) => r.config.id === p.symbolId).provider.id);
          }
        } catch (e) {
          progressError = redact(e?.message ?? String(e));
        }
        return reply(200, {
          ok: true,
          ...summary,
          // A symbol that cannot be imported is never "up to date", and is named as
          // missing from the common frontier rather than silently left out.
          upToDate: summary.upToDate && notReady.length === 0,
          commonScope: { symbols: ready.length, excluded: notReady.map((n) => n.symbol) },
          perSymbol: [...summary.perSymbol, ...notReady],
          interruptedJobsClosed,
          ...(progressError ? { progressError } : {}),
        });
      }

      // ------------------------------------------------------------ one symbol
      const loaded = await loadSymbolWithProvider({ rest, env, fetchImpl, now, symbol });
      if (!loaded.ok) return failure(loaded.status, loaded.code, redact(loaded.message));
      const { config, provider } = loaded;
      const w = windowOrFailure(config);
      if (w.error) return failure(w.error.status, w.error.code, w.error.message);

      const cap = jobCap(provider);
      if (!Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > cap) {
        return failure(400, 'BAD_REQUEST', `"maxJobs" must be an integer from 1 to ${cap} for this provider plan.`);
      }

      const interruptedJobsClosed = await store.closeInterruptedJobs(config.id, staleIso, nowIso);
      const answered = mergeCoverage(await store.answeredRanges(config.id, provider.id));

      let range = explicitRange;
      if (continuing) {
        const cp = checkpointOf(answered);
        if (!cp) {
          return failure(409, 'NO_HISTORY_YET', `"${symbol}" has no answered history yet: start with an explicit startUtc/endUtc.`);
        }
        if (cp.checkpoint >= settledIso) {
          return reply(200, { ok: true, symbol: config.symbol, provider: provider.id, upToDate: true, checkpointUtc: cp.checkpoint, settledUntilUtc: settledIso, interruptedJobsClosed, jobs: [], windows: 0 });
        }
        range = defineRange(cp.historyStart, settledIso);
      }

      const summary = await runImport({
        runId: newRunId(),
        symbolRow: config,
        config,
        provider,
        range,
        answered,
        store,
        maxJobs,
        keep: w.keep,
        now,
        secrets: allSecrets,
      });

      // Checkpoint after this run, and the refreshed history summary.
      const after = mergeCoverage([
        ...answered,
        ...summary.jobs.filter((j) => j.status === 'succeeded').map((j) => ({ start: j.startUtc, end: j.endUtc })),
      ]);
      const cp = checkpointOf(after);
      let progress = null;
      let progressError = null;
      try {
        if (summary.totals.inserted > 0) await store.refreshProgress(config.id, provider.id);
        progress = await store.progress(config.id, provider.id);
      } catch (e) {
        progressError = redact(e?.message ?? String(e));
      }
      Object.assign(summary, {
        mode: continuing ? 'continue' : 'range',
        researchWindow: w.keep.label,
        interruptedJobsClosed,
        settledUntilUtc: settledIso,
        historyStartUtc: cp?.historyStart ?? null,
        checkpointUtc: cp?.checkpoint ?? null,
        progress,
        ...(progressError ? { progressError } : {}),
      });
      return reply(200, { ok: true, ...summary });
    } catch (e) {
      if (e instanceof ProviderError) return providerFailure(e, redact);
      log(`importer: unexpected error: ${redact(e?.stack ?? e)}`);
      return failure(500, 'INTERNAL_ERROR', redact(e?.message ?? String(e)));
    }
  };
}

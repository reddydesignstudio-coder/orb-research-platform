/**
 * Importer storage on PostgREST (DATABASE.md — import_jobs, candles).
 * The engine talks to this interface only, so it is tested with an in-memory store.
 */

const INSERT_CHUNK = 1000;
const PAGE = 1000; // PostgREST default max rows
const LOOKUP_CHUNK = 100; // minutes per lookup request (keeps URLs short)

/** @param {ReturnType<import('../server/rest.js').createRestClient>} rest */
export function createImportStore(rest) {
  return Object.freeze({
    /** @returns {Promise<number>} job id */
    async createJob(job) {
      const [row] = await rest.insert('import_jobs', [job], { params: { select: 'id' } });
      return row.id;
    },

    async updateJob(id, patch) {
      await rest.update('import_jobs', { id: `eq.${id}` }, patch);
    },

    /**
     * Requested windows of definitively answered (succeeded) jobs — the answered
     * coverage for one symbol / provider / interval (PROVIDERS.md §6.1).
     * @returns {Promise<{ start: string, end: string }[]>}
     */
    async answeredRanges(symbolId, provider) {
      const out = [];
      for (let offset = 0; ; offset += PAGE) {
        const rows = await rest.select('import_jobs', {
          symbol_id: `eq.${symbolId}`,
          provider: `eq.${provider}`,
          interval: 'eq.1min',
          status: 'eq.succeeded',
          select: 'requested_start,requested_end',
          order: 'requested_start.asc,id.asc',
          limit: String(PAGE),
          offset: String(offset),
        });
        for (const r of rows) out.push({ start: new Date(r.requested_start).toISOString(), end: new Date(r.requested_end).toISOString() });
        if (rows.length < PAGE) return out;
      }
    },

    /**
     * Jobs still "running" long after they started were interrupted (function
     * crash or timeout). They are closed as failed/INTERRUPTED so their windows
     * count as not done and are requested again (PROVIDERS.md §12).
     * @returns {Promise<number>} jobs closed
     */
    async closeInterruptedJobs(symbolId, startedBeforeIso, nowIso) {
      const rows = await rest.update(
        'import_jobs',
        { symbol_id: `eq.${symbolId}`, status: 'eq.running', started_at: `lt.${startedBeforeIso}`, select: 'id' },
        { status: 'failed', error_code: 'INTERRUPTED', error_message: 'Job did not finish (interrupted); its window will be requested again.', completed_at: nowIso },
      );
      return Array.isArray(rows) ? rows.length : 0;
    },

    /**
     * Start times of this provider's recorded requests since `sinceIso` — what the
     * credit budget counts (TASK 012). One UTC day is at most a few hundred rows.
     * @returns {Promise<string[]>}
     */
    async jobStartsSince(provider, sinceIso) {
      const out = [];
      for (let offset = 0; ; offset += PAGE) {
        const rows = await rest.select('import_jobs', {
          provider: `eq.${provider}`,
          started_at: `gte.${sinceIso}`,
          select: 'started_at',
          order: 'started_at.asc',
          limit: String(PAGE),
          offset: String(offset),
        });
        for (const r of rows) if (r.started_at) out.push(new Date(r.started_at).toISOString());
        if (rows.length < PAGE) return out;
      }
    },

    /** Recompute import_progress from stored candles (migration 20260925190000). */
    async refreshProgress(symbolId, provider) {
      await rest.rpc('refresh_import_progress', { p_symbol_id: symbolId, p_provider: provider, p_interval: '1min' });
    },

    /** @returns {Promise<object|null>} the import_progress row */
    async progress(symbolId, provider) {
      const rows = await rest.select('import_progress', {
        symbol_id: `eq.${symbolId}`,
        provider: `eq.${provider}`,
        interval: 'eq.1min',
        select: 'first_timestamp_utc,last_timestamp_utc,candle_count,common_dataset_timestamp,updated_at',
      });
      return rows[0] ?? null;
    },

    /**
     * Insert candles; rows whose minute is already stored are skipped by the unique
     * key (symbol_id, interval, timestamp_utc) and never stored twice (RULES.md — DATA 7).
     * Callers pass candles with unique minutes (dedupeResponse), so the database never
     * has to choose between two versions of one minute.
     * @returns {Promise<string[]>} minutes (ISO UTC) actually inserted
     */
    async insertCandles(symbolId, candles) {
      const inserted = [];
      for (let i = 0; i < candles.length; i += INSERT_CHUNK) {
        const rows = candles.slice(i, i + INSERT_CHUNK).map((c) => ({
          symbol_id: symbolId,
          timestamp_utc: c.timestampUtc,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
          provider: c.provider,
          interval: c.interval,
        }));
        const out = await rest.insert('candles', rows, {
          params: { on_conflict: 'symbol_id,interval,timestamp_utc', select: 'timestamp_utc' },
          prefer: 'return=representation,resolution=ignore-duplicates',
        });
        for (const r of Array.isArray(out) ? out : []) inserted.push(new Date(r.timestamp_utc).toISOString());
      }
      return inserted;
    },

    /**
     * Stored candles for the given minutes, with prices as exact text (no float
     * conversion), for comparing with what the provider sends now.
     * @returns {Promise<object[]>} { timestampUtc, open, high, low, close, volume }
     */
    async storedCandles(symbolId, minutes) {
      const out = [];
      for (let i = 0; i < minutes.length; i += LOOKUP_CHUNK) {
        const list = minutes.slice(i, i + LOOKUP_CHUNK).map((m) => `"${m}"`).join(',');
        const rows = await rest.select('candles', {
          symbol_id: `eq.${symbolId}`,
          interval: 'eq.1min',
          timestamp_utc: `in.(${list})`,
          select: 'timestamp_utc,open::text,high::text,low::text,close::text,volume::text',
        });
        for (const r of rows) {
          out.push({ timestampUtc: new Date(r.timestamp_utc).toISOString(), open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume ?? null });
        }
      }
      return out;
    },
  });
}

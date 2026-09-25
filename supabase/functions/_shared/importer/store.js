/**
 * Importer storage on PostgREST (DATABASE.md — import_jobs, candles).
 * The engine talks to this interface only, so it is tested with an in-memory store.
 */

const INSERT_CHUNK = 1000;

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
     * Insert candles; rows that already exist are skipped by the unique key
     * (symbol_id, interval, timestamp_utc) and never stored twice (RULES.md — DATA 7).
     * @returns {Promise<number>} rows actually inserted
     */
    async insertCandles(symbolId, candles) {
      let inserted = 0;
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
          params: { on_conflict: 'symbol_id,interval,timestamp_utc', select: 'id' },
          prefer: 'return=representation,resolution=ignore-duplicates',
        });
        inserted += Array.isArray(out) ? out.length : 0;
      }
      return inserted;
    },
  });
}

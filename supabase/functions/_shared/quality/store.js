/**
 * Database access for the data quality engine (TASK 014) through PostgREST.
 * Uses a Supabase secret key (server-side only, D-020).
 */

const PAGE = 1000; // PostgREST default max rows
const UPSERT_BATCH = 200;

export function createQualityStore(rest) {
  return Object.freeze({
    /** Session dates that already have a data_quality row for this symbol. */
    async assessedDates(symbolId) {
      const out = new Set();
      for (let offset = 0; ; offset += PAGE) {
        const rows = await rest.select('data_quality', {
          symbol_id: `eq.${symbolId}`, select: 'session_date', order: 'session_date.asc', limit: String(PAGE), offset: String(offset),
        });
        for (const r of rows) out.add(r.session_date);
        if (rows.length < PAGE) return out;
      }
    },

    /** Stored 1-minute candles in [startUtc, endUtc), exact decimals as text. */
    async candlesBetween(symbolId, startUtc, endUtc) {
      const out = [];
      for (let offset = 0; ; offset += PAGE) {
        const rows = await rest.select('candles', {
          symbol_id: `eq.${symbolId}`,
          interval: 'eq.1min',
          and: `(timestamp_utc.gte.${startUtc},timestamp_utc.lt.${endUtc})`,
          select: 'timestamp_utc,open::text,high::text,low::text,close::text',
          order: 'timestamp_utc.asc',
          limit: String(PAGE),
          offset: String(offset),
        });
        for (const r of rows) out.push({ timestampUtc: new Date(r.timestamp_utc).toISOString(), open: r.open, high: r.high, low: r.low, close: r.close });
        if (rows.length < PAGE) return out;
      }
    },

    /** Insert or replace rows by (symbol_id, session_date). */
    async upsertRows(rows) {
      for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
        await rest.insert('data_quality', rows.slice(i, i + UPSERT_BATCH), {
          params: { on_conflict: 'symbol_id,session_date' },
          prefer: 'resolution=merge-duplicates,return=minimal',
        });
      }
    },

    /** Counts per status for a symbol (for the report). */
    async statusCounts(symbolId) {
      const counts = {};
      for (let offset = 0; ; offset += PAGE) {
        const rows = await rest.select('data_quality', {
          symbol_id: `eq.${symbolId}`, select: 'status,missing_candles', order: 'session_date.asc', limit: String(PAGE), offset: String(offset),
        });
        for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
        if (rows.length < PAGE) return counts;
      }
    },
  });
}

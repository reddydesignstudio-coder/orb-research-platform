/**
 * In-memory stand-in for the importer store (tests only). Enforces the same
 * rules the database does for what the engine touches: the candle unique key,
 * immutability, import_jobs statuses and count consistency.
 */
const STATUSES = new Set(['pending', 'running', 'succeeded', 'partial', 'failed', 'rate_limited']);

export function createMemoryStore({ failInsert = null } = {}) {
  const jobs = new Map();
  const candles = new Map(); // key symbol|interval|ts → candle
  let nextId = 1;

  function checkJob(j) {
    if (!STATUSES.has(j.status)) throw new Error(`bad status ${j.status}`);
    if (['failed', 'rate_limited'].includes(j.status) && !j.error_code) throw new Error('failure without code');
    const r = j.received_count ?? 0;
    if ((j.inserted_count ?? 0) + (j.duplicate_count ?? 0) > r) throw new Error('counts inconsistent');
    if (j.next_retry_at && !['failed', 'rate_limited', 'partial'].includes(j.status)) throw new Error('retry on wrong status');
  }

  return {
    jobs,
    candles,
    async createJob(job) {
      const id = nextId++;
      const row = { id, received_count: 0, inserted_count: 0, duplicate_count: 0, ...job };
      checkJob(row);
      jobs.set(id, row);
      return id;
    },
    async updateJob(id, patch) {
      const row = { ...jobs.get(id), ...patch };
      checkJob(row);
      jobs.set(id, row);
    },
    async insertCandles(symbolId, list) {
      if (failInsert) throw failInsert;
      let inserted = 0;
      for (const c of list) {
        const key = `${symbolId}|${c.interval}|${c.timestampUtc}`;
        if (!candles.has(key)) {
          candles.set(key, Object.freeze({ ...c, symbolId }));
          inserted++;
        }
      }
      return inserted;
    },
  };
}

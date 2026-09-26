/**
 * Minimal fake PostgREST for data-quality tests (no network): symbols, import_jobs,
 * candles (with the `and=(timestamp_utc.gte.…,timestamp_utc.lt.…)` filter) and
 * data_quality (select + upsert on symbol_id,session_date).
 */
export const SECRET = ['sb', 'secret', 'qualityfake0123456789'].join('_');
export const BASE = 'https://project.supabase.test';

const NY = { session_timezone: 'America/New_York', session_start: '09:30:00', session_end: '11:00:00' };
export const SYMBOLS = [
  { id: 1, symbol: 'SPY', market: 'us_stock', provider: 'twelve_data', provider_symbol: 'SPY', enabled: true, ...NY },
  { id: 2, symbol: 'BTC/USD', market: 'crypto', provider: 'twelve_data', provider_symbol: 'BTC/USD', enabled: true, ...NY },
  { id: 3, symbol: 'NOSESS', market: 'forex', provider: 'twelve_data', provider_symbol: 'NOSESS', enabled: true, session_timezone: 'UTC', session_start: null, session_end: null },
];

function passes(row, params) {
  for (const [k, v] of Object.entries(params)) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    if (k === 'and') {
      const [, a, b] = /^\(timestamp_utc\.gte\.(.+),timestamp_utc\.lt\.(.+)\)$/.exec(v);
      const t = Date.parse(row.timestamp_utc);
      if (!(t >= Date.parse(a) && t < Date.parse(b))) return false;
      continue;
    }
    const [op, ...rest] = v.split('.');
    if (op === 'eq' && String(row[k]) !== rest.join('.')) return false;
  }
  return true;
}

export function fakeDb({ jobs = [], candles = [], quality = [], failOn = null } = {}) {
  const db = { jobs, candles, quality: quality.map((q) => ({ ...q })), upserts: 0, reads: [] };
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    if (u.origin !== BASE) throw new TypeError('unexpected host');
    if (init.headers?.apikey !== SECRET) return new Response('{"message":"bad key"}', { status: 401 });
    const table = u.pathname.replace('/rest/v1/', '');
    const params = Object.fromEntries(u.searchParams);
    if (failOn === table) return new Response(JSON.stringify({ code: 'XX000', message: 'boom' }), { status: 500 });
    const method = init.method ?? 'GET';
    if (method === 'POST' && table === 'data_quality') {
      db.upserts += 1;
      for (const r of JSON.parse(init.body)) {
        const i = db.quality.findIndex((q) => q.symbol_id === r.symbol_id && q.session_date === r.session_date);
        if (i >= 0) db.quality[i] = { ...db.quality[i], ...r };
        else db.quality.push({ ...r });
      }
      return new Response('', { status: 201 });
    }
    db.reads.push(table);
    const source = { symbols: SYMBOLS, import_jobs: db.jobs, candles: db.candles, data_quality: db.quality }[table];
    let rows = source.filter((r) => passes(r, params));
    if (table === 'symbols' && params.enabled) rows = rows.filter((r) => r.enabled);
    const offset = Number(params.offset ?? 0);
    const limit = Number(params.limit ?? 1e9);
    rows = rows.slice(offset, offset + limit);
    return Response.json(rows);
  };
  return { db, fetchImpl };
}

/** A succeeded import job covering [start, end). */
export const job = (symbol_id, start, end) => ({ symbol_id, provider: 'twelve_data', interval: '1min', status: 'succeeded', requested_start: start, requested_end: end });

/** n candles from startIso, one per minute. */
export const candlesFrom = (symbol_id, startIso, n, skip = []) =>
  Array.from({ length: n }, (_, i) => new Date(Date.parse(startIso) + i * 60_000).toISOString())
    .filter((_, i) => !skip.includes(i))
    .map((timestamp_utc) => ({ symbol_id, interval: '1min', timestamp_utc, open: '100.1', high: '100.5', low: '100', close: '100.4' }));

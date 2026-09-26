/**
 * Fake Supabase PostgREST + Twelve Data for importer tests (no network).
 * Implements just what the importer uses: eq./lt. filters, order/limit/offset,
 * ignore-duplicates on the candle unique key, PATCH with filters, the
 * refresh_import_progress RPC (same result as the SQL function).
 */
import assert from 'node:assert/strict';

export const SECRET = ['sb', 'secret', 'importfake0123456789'].join('_');
export const TD_KEY = ['td', 'live', 'importfake98765'].join('_');
export const BASE = 'https://project.supabase.test';

export const SYMBOLS = [
  { id: 1, symbol: 'SPY', market: 'us_stock', provider: 'twelve_data', provider_symbol: 'SPY', enabled: true },
  { id: 2, symbol: 'QQQ', market: 'us_stock', provider: 'twelve_data', provider_symbol: 'QQQ', enabled: true },
];

/** Twelve Data style bars for n minutes from startIso (UTC). */
export const bars = (startIso, n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.parse(startIso) + i * 60_000).toISOString();
    return { datetime: `${d.slice(0, 10)} ${d.slice(11, 19)}`, open: '100.10', high: '100.50', low: '100.00', close: '100.40', volume: '1000' };
  });

function matches(row, params) {
  for (const [k, v] of Object.entries(params)) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const [op, ...rest] = v.split('.');
    const want = rest.join('.');
    const have = row[k];
    if (op === 'eq' && String(have) !== want) return false;
    if (op === 'lt' && !(Date.parse(have) < Date.parse(want))) return false;
  }
  return true;
}

/**
 * @param {object} [o]
 * @param {Record<string, object[]>} [o.tdRows]     Twelve Data values keyed by start_date sent
 * @param {Record<string, object>} [o.tdErrors]     Twelve Data error bodies keyed by start_date
 * @param {object[]} [o.jobs]                       pre-existing import_jobs rows
 * @param {object[]} [o.candles]                    pre-existing candles rows
 */
export function fakeBackend({ tdRows = {}, tdErrors = {}, jobs = [], candles = [] } = {}) {
  const db = { jobs: jobs.map((j, i) => ({ id: i + 1, received_count: 0, inserted_count: 0, duplicate_count: 0, ...j })), candles: candles.map((c, i) => ({ id: i + 1, ...c })), progress: [], tdCalls: [] };

  function refreshProgress({ p_symbol_id, p_provider }) {
    const mine = db.candles.filter((c) => c.symbol_id === p_symbol_id && c.provider === p_provider).map((c) => c.timestamp_utc).sort();
    let row = db.progress.find((p) => p.symbol_id === p_symbol_id && p.provider === p_provider);
    if (!row) db.progress.push((row = { symbol_id: p_symbol_id, provider: p_provider, interval: '1min' }));
    Object.assign(row, { first_timestamp_utc: mine[0] ?? null, last_timestamp_utc: mine.at(-1) ?? null, candle_count: mine.length });
    const lasts = SYMBOLS.filter((s) => s.enabled).map((s) => db.progress.find((p) => p.symbol_id === s.id)?.last_timestamp_utc ?? null);
    const common = lasts.includes(null) ? null : lasts.sort()[0];
    for (const p of db.progress) p.common_dataset_timestamp = common;
  }

  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const params = Object.fromEntries(u.searchParams);

    if (u.hostname === 'api.twelvedata.com') {
      const start = params.start_date;
      db.tdCalls.push(start);
      if (tdErrors[start]) return new Response(JSON.stringify(tdErrors[start]), { status: 200 });
      const values = tdRows[start] ?? [];
      if (!values.length) return Response.json({ code: 400, message: 'No data is available on the specified dates.', status: 'error' });
      return Response.json({ meta: { symbol: params.symbol, interval: '1min' }, values, status: 'ok' });
    }
    if (u.origin !== BASE) throw new TypeError('fetch failed: unexpected host');
    if (init.headers?.apikey !== SECRET) return new Response('{"message":"bad key"}', { status: 401 });

    const table = u.pathname.replace('/rest/v1/', '');
    const body = init.body ? JSON.parse(init.body) : null;

    if (table === 'symbols' && method === 'GET') return Response.json(SYMBOLS.filter((s) => matches(s, params)));

    if (table === 'import_jobs' && method === 'GET') {
      let rows = db.jobs.filter((j) => matches(j, params)).sort((a, b) => (a.requested_start < b.requested_start ? -1 : a.requested_start > b.requested_start ? 1 : a.id - b.id));
      rows = rows.slice(Number(params.offset ?? 0), Number(params.offset ?? 0) + Number(params.limit ?? 1000));
      return Response.json(rows.map((r) => ({ requested_start: r.requested_start, requested_end: r.requested_end })));
    }
    if (table === 'import_jobs' && method === 'POST') {
      const row = { id: db.jobs.length + 1, received_count: 0, inserted_count: 0, duplicate_count: 0, ...body[0] };
      db.jobs.push(row);
      return Response.json([{ id: row.id }], { status: 201 });
    }
    if (table === 'import_jobs' && method === 'PATCH') {
      const hit = db.jobs.filter((j) => matches(j, params));
      for (const j of hit) Object.assign(j, body);
      return Response.json(hit.map((j) => ({ id: j.id })));
    }
    if (table === 'candles' && method === 'POST') {
      assert.equal(params.on_conflict, 'symbol_id,interval,timestamp_utc');
      assert.match(init.headers.prefer, /resolution=ignore-duplicates/);
      assert.equal(params.select, 'timestamp_utc');
      const inserted = [];
      for (const r of body) {
        const dup = db.candles.some((c) => c.symbol_id === r.symbol_id && c.interval === r.interval && c.timestamp_utc === r.timestamp_utc);
        if (!dup) {
          const row = { id: db.candles.length + 1, ...r };
          db.candles.push(row);
          // PostgREST renders timestamptz with an offset, not "Z".
          inserted.push({ timestamp_utc: r.timestamp_utc.replace('.000Z', '+00:00') });
        }
      }
      return Response.json(inserted, { status: 201 });
    }
    if (table === 'candles' && method === 'GET') {
      assert.equal(params.select, 'timestamp_utc,open::text,high::text,low::text,close::text,volume::text');
      const wanted = params.timestamp_utc.replace(/^in\.\(/, '').replace(/\)$/, '').split(',').map((x) => x.replace(/"/g, ''));
      const rows = db.candles.filter((c) => String(c.symbol_id) === params.symbol_id.replace('eq.', '') && wanted.includes(c.timestamp_utc));
      return Response.json(rows.map((c) => ({ timestamp_utc: c.timestamp_utc.replace('.000Z', '+00:00'), open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume })));
    }
    if (table === 'rpc/refresh_import_progress' && method === 'POST') {
      refreshProgress(body);
      return new Response(null, { status: 204 });
    }
    if (table === 'import_progress' && method === 'GET') return Response.json(db.progress.filter((p) => matches(p, params)));
    return new Response('{"message":"not found"}', { status: 404 });
  };
  return { db, fetchImpl };
}

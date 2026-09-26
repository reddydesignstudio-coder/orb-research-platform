/**
 * Minimal PostgREST client for Edge Functions (no dependencies).
 * Uses a Supabase secret key, which bypasses RLS — server-side only (D-011, D-020).
 */

export class RestError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RestError';
    this.status = status;
  }
}

/**
 * @param {object} p
 * @param {string} p.baseUrl   SUPABASE_URL
 * @param {string} p.key       a Supabase secret key
 * @param {typeof fetch} [p.fetchImpl]
 */
export function createRestClient({ baseUrl, key, fetchImpl = globalThis.fetch }) {
  if (!baseUrl || !key) throw new TypeError('baseUrl and key are required');

  async function call(method, table, params, body, prefer) {
    const url = `${baseUrl}/rest/v1/${table}${params ? `?${new URLSearchParams(params)}` : ''}`;
    const headers = { apikey: key, accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (prefer) headers.prefer = prefer;
    let res;
    try {
      res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new RestError(0, `Database request failed: ${e?.message ?? e}`);
    }
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 500);
      try {
        const j = JSON.parse(text);
        detail = [j.code, j.message, j.details, j.hint].filter(Boolean).join(' — ');
      } catch { /* keep raw text */ }
      throw new RestError(res.status, `Database ${method} ${table} failed (HTTP ${res.status}): ${detail}`);
    }
    return text ? JSON.parse(text) : null;
  }

  return Object.freeze({
    /** GET rows. `params` are PostgREST query params, e.g. { symbol: 'eq.SPY', select: 'id' }. */
    select: (table, params) => call('GET', table, params),
    /** INSERT; returns the rows PostgREST returns (use `select` in params to limit columns). */
    insert: (table, rows, { params, prefer = 'return=representation' } = {}) => call('POST', table, params, rows, prefer),
    /** PATCH rows matching `params` filters; returns updated rows. */
    update: (table, params, patch) => call('PATCH', table, params, patch, 'return=representation'),
    /** Call a database function: POST /rest/v1/rpc/<name>. */
    rpc: (name, args) => call('POST', `rpc/${name}`, undefined, args),
  });
}

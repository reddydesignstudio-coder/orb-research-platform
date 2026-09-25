/**
 * Live database status for the header pill.
 *
 * Calls the Supabase Auth health endpoint with the PUBLIC publishable key —
 * the same check as scripts/check-supabase.mjs. No data is read.
 * `fetchFn` is injectable so the classification can be unit-tested.
 */

/**
 * @typedef {{ state: 'unconfigured' | 'online' | 'paused' | 'error' | 'offline', label: string, detail: string }} Health
 */

/**
 * @param {import('./config.js').ConfigResult} config
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<Health>}
 */
export async function checkHealth(config, fetchFn = globalThis.fetch) {
  if (config.state === 'unconfigured') {
    return { state: 'unconfigured', label: 'Database not set up', detail: 'No Supabase project configured.' };
  }
  if (config.state !== 'ready') {
    return { state: 'error', label: 'Config error', detail: config.errors.map((e) => e.code).join(', ') };
  }

  const url = `${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/health`;
  let res;
  try {
    res = await fetchFn(url, { headers: { apikey: config.supabaseAnonKey }, signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    return { state: 'offline', label: 'Database unreachable', detail: `Network error: ${err?.message ?? err}` };
  }
  return classifyHealthStatus(res.status);
}

/**
 * @param {number} status HTTP status from the health endpoint
 * @returns {Health}
 */
export function classifyHealthStatus(status) {
  if (status === 200) return { state: 'online', label: 'Database online', detail: 'Supabase project reachable.' };
  if (status === 540 || status === 503) {
    return { state: 'paused', label: 'Database paused', detail: 'Resume the project in the Supabase dashboard.' };
  }
  if (status === 401 || status === 403) {
    return { state: 'error', label: 'Key rejected', detail: `HTTP ${status}: check the publishable key.` };
  }
  return { state: 'error', label: 'Database error', detail: `Unexpected HTTP ${status}.` };
}

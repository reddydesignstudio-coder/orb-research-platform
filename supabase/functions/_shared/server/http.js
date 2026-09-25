/**
 * Shared HTTP helpers for server-only Edge Functions (D-020).
 * Callers must present a Supabase SECRET key in the apikey header.
 */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

/** Read the named secret keys Supabase provides as a JSON object. */
export function parseSecretKeys(raw) {
  if (!raw) return [];
  try {
    const obj = JSON.parse(raw);
    return Object.values(obj ?? {}).filter((v) => typeof v === 'string' && v.length >= 16);
  } catch {
    return [];
  }
}

/** Constant-time string comparison. */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
export const failure = (status, code, message, extra = {}) => reply(status, { ok: false, error: { code, message, ...extra } });

/**
 * Method + caller check shared by every server-only function.
 * @returns {Response | null}  a response to return immediately, or null when allowed
 */
export function guardServerRequest(req, secretKeys) {
  if (req.method !== 'POST') return failure(405, 'METHOD_NOT_ALLOWED', 'Use POST.');
  if (secretKeys.length === 0) {
    return failure(500, 'SERVER_MISCONFIGURED', 'SUPABASE_SECRET_KEYS is not available to the function.');
  }
  const presented = req.headers.get('apikey') ?? '';
  if (!secretKeys.some((k) => safeEqual(k, presented))) {
    return failure(401, 'UNAUTHORIZED', 'A Supabase secret key is required in the apikey header.');
  }
  return null;
}

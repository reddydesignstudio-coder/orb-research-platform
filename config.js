/**
 * Validation of the public frontend configuration (app-config.js).
 *
 * Purpose: fail loudly if a secret ever reaches the browser bundle
 * (PROJECT.md §14, RULES.md — SECURITY). Pure function, no DOM access.
 */

export const ALLOWED_FIELDS = Object.freeze(['supabaseUrl', 'supabaseAnonKey']);

/**
 * @typedef {{ code: string, message: string }} ConfigError
 * @typedef {{ state: 'unconfigured' | 'ready' | 'invalid', errors: ConfigError[], supabaseUrl: string, supabaseAnonKey: string }} ConfigResult
 */

/**
 * Decode the payload of a JWT without verifying it. Returns null if the
 * value is not a well-formed JWT. Used only to read the `role` claim.
 * @param {string} token
 * @returns {Record<string, unknown> | null}
 */
export function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = JSON.parse(atob(padded));
    return json && typeof json === 'object' ? json : null;
  } catch {
    return null;
  }
}

/**
 * Classify a Supabase API key.
 * @param {string} key
 * @returns {'publishable' | 'anon-jwt' | 'secret' | 'service-role-jwt' | 'unknown'}
 */
export function classifySupabaseKey(key) {
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  const payload = decodeJwtPayload(key);
  if (payload) {
    if (payload.role === 'service_role') return 'service-role-jwt';
    if (payload.role === 'anon') return 'anon-jwt';
  }
  return 'unknown';
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {ConfigResult}
 */
export function validateConfig(raw) {
  /** @type {ConfigError[]} */
  const errors = [];
  const cfg = raw && typeof raw === 'object' ? raw : {};

  for (const field of Object.keys(cfg)) {
    if (!ALLOWED_FIELDS.includes(field)) {
      errors.push({
        code: 'UNEXPECTED_FIELD',
        message: `app-config.js contains "${field}". Only ${ALLOWED_FIELDS.join(', ')} are allowed in public configuration.`,
      });
    }
  }

  const supabaseUrl = typeof cfg.supabaseUrl === 'string' ? cfg.supabaseUrl.trim() : '';
  const supabaseAnonKey = typeof cfg.supabaseAnonKey === 'string' ? cfg.supabaseAnonKey.trim() : '';

  if (supabaseUrl === '' && supabaseAnonKey === '' && errors.length === 0) {
    return { state: 'unconfigured', errors, supabaseUrl, supabaseAnonKey };
  }

  if (supabaseUrl === '') {
    errors.push({ code: 'MISSING_URL', message: 'supabaseUrl is empty but supabaseAnonKey is set.' });
  } else {
    let parsed = null;
    try {
      parsed = new URL(supabaseUrl);
    } catch {
      errors.push({ code: 'INVALID_URL', message: `supabaseUrl is not a valid URL: ${supabaseUrl}` });
    }
    if (parsed && parsed.protocol !== 'https:') {
      errors.push({ code: 'INSECURE_URL', message: 'supabaseUrl must use https://.' });
    }
  }

  if (supabaseAnonKey === '') {
    errors.push({ code: 'MISSING_KEY', message: 'supabaseAnonKey is empty but supabaseUrl is set.' });
  } else {
    const kind = classifySupabaseKey(supabaseAnonKey);
    if (kind === 'secret' || kind === 'service-role-jwt') {
      errors.push({
        code: 'SECRET_KEY_IN_FRONTEND',
        message:
          'supabaseAnonKey is a service-role / secret key. It must never be in the frontend. ' +
          'Remove it, rotate it in the Supabase dashboard, and use the anon / publishable key instead.',
      });
    } else if (kind === 'unknown') {
      errors.push({
        code: 'UNRECOGNISED_KEY',
        message: 'supabaseAnonKey is not a recognisable Supabase anon or publishable key.',
      });
    }
  }

  return { state: errors.length ? 'invalid' : 'ready', errors, supabaseUrl, supabaseAnonKey };
}

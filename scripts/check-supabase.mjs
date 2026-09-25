#!/usr/bin/env node
/**
 * Connectivity check for the Supabase project named in frontend/js/app-config.js.
 *
 *   npm run check:supabase
 *
 * Uses only the PUBLIC URL and publishable key — the same values the browser
 * uses. Calls the Auth health endpoint, which exists before any tables do.
 * Proves: the URL is right, the project is running (not paused) and the key
 * is accepted. Needs network access to *.supabase.co.
 *
 * Exit codes: 0 reachable, 1 misconfigured / rejected / unreachable.
 */

import rawConfig from '../frontend/js/app-config.js';
import { validateConfig } from '../frontend/js/config.js';

const config = validateConfig(rawConfig);

if (config.state !== 'ready') {
  console.error(`FAIL config state is "${config.state}"`);
  for (const e of config.errors) console.error(`  ${e.code}: ${e.message}`);
  process.exit(1);
}

const url = `${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/health`;
let res;
try {
  res = await fetch(url, {
    headers: { apikey: config.supabaseAnonKey },
    signal: AbortSignal.timeout(15_000),
  });
} catch (err) {
  console.error(`FAIL could not reach ${config.supabaseUrl}: ${err.cause?.code ?? err.name}: ${err.message}`);
  console.error('     Check the project URL, your network, and whether the project is paused.');
  process.exit(1);
}

const body = await res.text();
if (res.status === 200) {
  console.log(`PASS Supabase project reachable and key accepted (${config.supabaseUrl})`);
  process.exit(0);
}

const hints = {
  401: 'The publishable key was rejected. Copy it again from Project Settings → API Keys.',
  403: 'Access forbidden. Check the key.',
  404: 'Endpoint not found. Check the project URL.',
  503: 'Service unavailable. The project may be paused or still starting — open the Supabase dashboard.',
  540: 'The project is paused. Resume it in the Supabase dashboard.',
};
console.error(`FAIL HTTP ${res.status} from ${url}`);
console.error(`     ${hints[res.status] ?? 'Unexpected response.'}`);
console.error(`     Response: ${body.slice(0, 300)}`);
process.exit(1);

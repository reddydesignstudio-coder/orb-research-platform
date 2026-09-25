/**
 * Guards for PROJECT.md §14 / RULES.md — SECURITY: nothing secret may be
 * shipped in the GitHub Pages frontend.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { FRONTEND_ROOT } from '../scripts/serve.mjs';

async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFiles(full)));
    else out.push(full);
  }
  return out;
}

// Strings that must never appear in shipped frontend code.
// app-config.js / config.js mention some of these words in comments and in the
// guard itself, so they are checked separately by config.test.js.
const FORBIDDEN = [
  /sb_secret_[A-Za-z0-9]/,
  /TWELVE_?DATA_?API_?KEY/i,
  /FINNHUB_?API_?KEY/i,
  /ALPHA_?VANTAGE_?API_?KEY/i,
  /FMP_?API_?KEY/i,
  /SUPABASE_SERVICE_ROLE_KEY/i,
  /api\.twelvedata\.com/i, // provider must only be called from Edge Functions
  /localStorage|sessionStorage|indexedDB/, // RULES.md — DATABASE (none used yet)
];

test('frontend contains no secrets, provider calls or browser-storage databases', async () => {
  const files = (await listFiles(FRONTEND_ROOT)).filter((f) => /\.(html|js|mjs|css|json)$/.test(f));
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(text, pattern, `${relative(FRONTEND_ROOT, file)} matches ${pattern}`);
    }
  }
});

test('index.html sets viewport and a restrictive Content-Security-Policy', async () => {
  const html = await readFile(join(FRONTEND_ROOT, 'index.html'), 'utf8');
  assert.match(html, /name="viewport"[^>]*width=device-width/);
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval/);
  assert.match(html, /<script type="module" src="js\/main\.js">/);
});

test('frontend makes no references to CDNs or third-party scripts', async () => {
  const files = (await listFiles(FRONTEND_ROOT)).filter((f) => /\.(html|js)$/.test(f));
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /<script[^>]+src="https?:/i, relative(FRONTEND_ROOT, file));
    assert.doesNotMatch(text, /import\s[^;]*from\s+['"]https?:/i, relative(FRONTEND_ROOT, file));
  }
});

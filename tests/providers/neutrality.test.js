/**
 * The shared provider layer must stay provider-neutral (TASK 005): no provider
 * names, endpoints, limits, symbol formats or credentials in shared code.
 * Provider-specific knowledge belongs in each adapter, after verification.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('../../supabase/functions/_shared/providers/', import.meta.url);

test('shared provider code contains no provider-specific names, endpoints or credentials', async () => {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.js'));
  assert.ok(files.length >= 6);
  const forbidden = [
    /twelve\s*_?data|twelvedata/i,
    /finnhub/i,
    /alpha\s*_?vantage/i,
    /financialmodelingprep|\bfmp\b/i,
    /https?:\/\//i, // no endpoints
    /apikey\s*=|api_key\s*=|Deno\.env|process\.env/, // shared code never reads secrets itself
  ];
  for (const f of files) {
    const text = await readFile(new URL(f, DIR), 'utf8');
    for (const p of forbidden) assert.doesNotMatch(text, p, `${f} matches ${p}`);
  }
});

test('shared provider code uses no Node-only APIs (must run in Deno Edge Functions)', async () => {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.js'));
  for (const f of files) {
    const text = await readFile(new URL(f, DIR), 'utf8');
    assert.doesNotMatch(text, /from\s+['"]node:|require\(|\bBuffer\b|process\./, f);
    for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      assert.match(m[1], /\.js$/, `${f}: relative imports need an explicit .js extension for Deno (${m[1]})`);
    }
  }
});

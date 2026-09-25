/**
 * Static checks on supabase/migrations (no database needed).
 *
 * RULES.md — DEPLOYMENT: "No destructive database operation without explicit
 * approval." Migrations are applied automatically on push (D-012), so a
 * destructive statement must carry an explicit approval marker:
 *
 *   -- approved-destructive: <who approved, when, why>
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

async function migrations() {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.sql')).sort();
  return Promise.all(files.map(async (name) => ({ name, sql: await readFile(new URL(name, DIR), 'utf8') })));
}

/** Remove comments and string/dollar-quoted bodies so keywords in them don't count. */
export function stripSql(sql) {
  return sql
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, ' ') // dollar-quoted bodies (functions)
    .replace(/'(?:[^']|'')*'/g, "''") // string literals
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/--[^\n]*/g, ' '); // line comments
}

export const DESTRUCTIVE = [
  /\bdrop\s+(table|schema|column|view|materialized\s+view|index|function|trigger|policy|type|extension)\b/i,
  /(?:^|;)\s*truncate\b/i, // a TRUNCATE statement (not the privilege / trigger-event keyword)
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[^;]*\bdrop\b/i,
  /\balter\s+table\b[^;]*\brename\b/i,
  /\bdisable\s+row\s+level\s+security\b/i,
];

test('migration file names are <14-digit timestamp>_<name>.sql and unique', async () => {
  const list = await migrations();
  assert.ok(list.length > 0, 'no migrations found');
  const stamps = new Set();
  for (const { name } of list) {
    const m = NAME.exec(name);
    assert.ok(m, `bad migration file name: ${name}`);
    assert.ok(!stamps.has(m[1]), `duplicate timestamp: ${name}`);
    stamps.add(m[1]);
  }
});

test('no destructive statement without an explicit approval marker', async () => {
  for (const { name, sql } of await migrations()) {
    if (/^--\s*approved-destructive:\s*\S+/m.test(sql)) continue;
    const body = stripSql(sql);
    for (const pattern of DESTRUCTIVE) {
      assert.doesNotMatch(body, pattern, `${name}: destructive statement ${pattern} needs "-- approved-destructive: <reason>"`);
    }
  }
});

test('every table created in a migration enables row level security in the same file', async () => {
  for (const { name, sql } of await migrations()) {
    const body = stripSql(sql);
    const created = [...body.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_."]+)/gi)].map((m) => m[1].replace(/"/g, ''));
    for (const table of created) {
      const re = new RegExp(`alter\\s+table\\s+${table.replace('.', '\\.')}\\s+enable\\s+row\\s+level\\s+security`, 'i');
      assert.match(body, re, `${name}: ${table} is created without enabling RLS`);
    }
  }
});

test('the guard itself detects destructive SQL and ignores comments / function bodies', () => {
  const hit = (sql) => DESTRUCTIVE.some((p) => p.test(stripSql(sql)));
  assert.equal(hit('drop table public.candles;'), true);
  assert.equal(hit('TRUNCATE public.candles;'), true);
  assert.equal(hit('select 1;\n  truncate table public.trades;'), true);
  assert.equal(hit('delete from public.candles where true;'), true);
  assert.equal(hit('alter table public.candles drop column volume;'), true);
  assert.equal(hit('alter table public.candles disable row level security;'), true);
  assert.equal(hit('-- we never drop table candles'), false);
  assert.equal(hit("create function f() returns trigger as $$ begin delete from x; end; $$ language plpgsql;"), false);
  assert.equal(hit('revoke insert, update, delete, truncate on all tables in schema public from anon;'), false);
  assert.equal(hit('create trigger t before truncate on public.candles for each statement execute function f();'), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inspectDbUrl } from '../scripts/check-db-url.mjs';

// Fake values only. The ref has the real 20-char shape; the passwords are made up.
const REF = 'abcdefghijklmnopqrst';
const url = (pw, extra = '') =>
  `postgresql://postgres.${REF}:${pw}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres${extra}`;

test('a well-formed Session pooler URL passes and never exposes the password', () => {
  const r = inspectDbUrl(url('Abc123def456ghi789'));
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.facts.passwordLength, 18);
  assert.ok(!JSON.stringify(r).includes('Abc123def456ghi789'));
});

test('placeholder, brackets, whitespace and newline are reported', () => {
  assert.match(inspectDbUrl(url('[YOUR-PASSWORD]')).problems.join(), /placeholder/);
  assert.match(inspectDbUrl(url('[Abc123]')).problems.join(), /square brackets/);
  assert.match(inspectDbUrl(url('Abc123') + '\n').problems.join(), /line break/);
  assert.match(inspectDbUrl(' ' + url('Abc123')).problems.join(), /space or line break/);
});

test('special characters and a raw @ in the password are reported', () => {
  assert.match(inspectDbUrl(url('Abc#123')).problems.join(), /special characters/);
  assert.match(inspectDbUrl(url('Abc@123')).problems.join(), /contains @/);
  assert.equal(inspectDbUrl(url('Abc%23123')).ok, true); // percent-encoded is fine
});

test('direct host, transaction port and wrong user are reported', () => {
  const direct = `postgresql://postgres:Abc123@db.${REF}.supabase.co:5432/postgres`;
  const p = inspectDbUrl(direct).problems.join();
  assert.match(p, /pooler host/);
  assert.match(p, /postgres\.<project-ref>/);
  assert.match(inspectDbUrl(url('Abc123').replace(':5432', ':6543')).problems.join(), /6543/);
});

test('empty secret is reported', () => {
  assert.equal(inspectDbUrl('').ok, false);
  assert.equal(inspectDbUrl(undefined).ok, false);
});

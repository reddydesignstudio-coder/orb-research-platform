import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, classifySupabaseKey, decodeJwtPayload } from '../frontend/js/config.js';

// Test keys are assembled at runtime so no credential-shaped literal exists in
// the repository (keeps scripts/verify-foundation.sh's scan meaningful).
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const fakeJwt = (payload) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${'s'.repeat(24)}`;
const ANON_JWT = fakeJwt({ iss: 'supabase', role: 'anon', ref: 'testproject' });
const SERVICE_JWT = fakeJwt({ iss: 'supabase', role: 'service_role', ref: 'testproject' });
const PUBLISHABLE = 'sb_' + 'publishable_' + 'x'.repeat(24);
const SECRET = 'sb_' + 'secret_' + 'x'.repeat(24);
const URL_OK = 'https://testproject.supabase.co';

test('empty config is "unconfigured", not an error', () => {
  const r = validateConfig({ supabaseUrl: '', supabaseAnonKey: '' });
  assert.equal(r.state, 'unconfigured');
  assert.deepEqual(r.errors, []);
});

test('the committed app-config.js is valid', async () => {
  const { default: committed } = await import('../frontend/js/app-config.js');
  const r = validateConfig(committed);
  assert.notEqual(r.state, 'invalid', JSON.stringify(r.errors));
});

test('anon JWT and publishable key are accepted', () => {
  assert.equal(validateConfig({ supabaseUrl: URL_OK, supabaseAnonKey: ANON_JWT }).state, 'ready');
  assert.equal(validateConfig({ supabaseUrl: URL_OK, supabaseAnonKey: PUBLISHABLE }).state, 'ready');
});

test('service-role JWT is rejected', () => {
  const r = validateConfig({ supabaseUrl: URL_OK, supabaseAnonKey: SERVICE_JWT });
  assert.equal(r.state, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'SECRET_KEY_IN_FRONTEND'));
});

test('sb_secret_ key is rejected', () => {
  const r = validateConfig({ supabaseUrl: URL_OK, supabaseAnonKey: SECRET });
  assert.equal(r.state, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'SECRET_KEY_IN_FRONTEND'));
});

test('any extra field (e.g. a provider key) is rejected', () => {
  const r = validateConfig({ supabaseUrl: '', supabaseAnonKey: '', twelveDataApiKey: 'x' });
  assert.equal(r.state, 'invalid');
  assert.ok(r.errors.some((e) => e.code === 'UNEXPECTED_FIELD'));
});

test('http:// URL and malformed URL are rejected', () => {
  assert.ok(
    validateConfig({ supabaseUrl: 'http://testproject.supabase.co', supabaseAnonKey: ANON_JWT }).errors.some(
      (e) => e.code === 'INSECURE_URL',
    ),
  );
  assert.ok(
    validateConfig({ supabaseUrl: 'not a url', supabaseAnonKey: ANON_JWT }).errors.some((e) => e.code === 'INVALID_URL'),
  );
});

test('half-filled config is rejected', () => {
  assert.ok(validateConfig({ supabaseUrl: URL_OK, supabaseAnonKey: '' }).errors.some((e) => e.code === 'MISSING_KEY'));
  assert.ok(validateConfig({ supabaseUrl: '', supabaseAnonKey: ANON_JWT }).errors.some((e) => e.code === 'MISSING_URL'));
});

test('unrecognised key format is rejected', () => {
  const r = validateConfig({ supabaseUrl: URL_OK, supabaseAnonKey: 'hello' });
  assert.ok(r.errors.some((e) => e.code === 'UNRECOGNISED_KEY'));
});

test('key classification', () => {
  assert.equal(classifySupabaseKey(ANON_JWT), 'anon-jwt');
  assert.equal(classifySupabaseKey(SERVICE_JWT), 'service-role-jwt');
  assert.equal(classifySupabaseKey(PUBLISHABLE), 'publishable');
  assert.equal(classifySupabaseKey(SECRET), 'secret');
  assert.equal(classifySupabaseKey('a.b.c'), 'unknown');
});

test('decodeJwtPayload tolerates garbage', () => {
  assert.equal(decodeJwtPayload('nope'), null);
  assert.equal(decodeJwtPayload('a.%%%.c'), null);
  assert.deepEqual(decodeJwtPayload(ANON_JWT).role, 'anon');
});

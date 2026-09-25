import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderError,
  ProviderErrorCode,
  RetryPolicy,
  classifyGenericError,
  redactSecrets,
  retryPolicyFor,
} from '../../supabase/functions/_shared/providers/mod.js';

const KEY = 'k' + 'ey_' + 'x'.repeat(24);

test('every error code has a retry policy (PROVIDERS.md §9)', () => {
  for (const code of Object.values(ProviderErrorCode)) {
    assert.ok(Object.values(RetryPolicy).includes(retryPolicyFor(code)), code);
  }
  assert.throws(() => retryPolicyFor('NOPE'), /Unknown provider error code/);
});

test('transient errors retry, human-action errors do not, quota waits, empty answer is not an error', () => {
  for (const c of ['NETWORK_ERROR', 'TIMEOUT', 'PROVIDER_UNAVAILABLE']) assert.equal(retryPolicyFor(c), RetryPolicy.RETRY_WITH_BACKOFF);
  assert.equal(retryPolicyFor('RATE_LIMITED'), RetryPolicy.WAIT_THEN_RETRY);
  assert.equal(retryPolicyFor('QUOTA_EXHAUSTED'), RetryPolicy.WAIT_FOR_QUOTA);
  for (const c of ['AUTH_FAILED', 'PLAN_RESTRICTED', 'SYMBOL_NOT_FOUND', 'INTERVAL_UNSUPPORTED', 'MALFORMED_RESPONSE', 'UNKNOWN']) {
    assert.equal(retryPolicyFor(c), RetryPolicy.NEEDS_HUMAN, c);
  }
  assert.equal(retryPolicyFor('NO_DATA_RETURNED'), RetryPolicy.NOT_AN_ERROR);
});

test('ProviderError redacts secrets from message and detail, including URL-encoded forms', () => {
  const tricky = KEY + '/+=';
  const e = new ProviderError({
    code: 'AUTH_FAILED',
    message: `rejected https://x.test/q?apikey=${encodeURIComponent(tricky)} and ${tricky}`,
    providerId: 'fake_provider',
    detail: { url: `https://x.test/?k=${tricky}` },
    secrets: [tricky],
  });
  assert.ok(!e.message.includes(KEY), e.message);
  assert.ok(!String(e.detail).includes(KEY));
  assert.match(e.message, /\[REDACTED\]/);
  assert.deepEqual(e.toRecord(), { error_code: 'AUTH_FAILED', error_message: e.message });
  assert.equal(e.retryPolicy, RetryPolicy.NEEDS_HUMAN);
});

test('ProviderError validates code and provider, and keeps a provider-signalled wait', () => {
  assert.throws(() => new ProviderError({ code: 'NOPE', message: 'x', providerId: 'p' }), /Unknown provider error code/);
  assert.throws(() => new ProviderError({ code: 'TIMEOUT', message: 'x' }), /providerId/);
  const e = new ProviderError({ code: 'RATE_LIMITED', message: 'x', providerId: 'p', retryAfterMs: 1500.4 });
  assert.equal(e.retryAfterMs, 1500);
  assert.equal(new ProviderError({ code: 'RATE_LIMITED', message: 'x', providerId: 'p', retryAfterMs: -1 }).retryAfterMs, undefined);
});

test('generic classification never guesses provider meaning', () => {
  assert.equal(classifyGenericError(new TypeError('fetch failed'), 'p').code, 'NETWORK_ERROR');
  const abort = new Error('aborted');
  abort.name = 'TimeoutError';
  assert.equal(classifyGenericError(abort, 'p').code, 'TIMEOUT');
  assert.equal(classifyGenericError(new Error('HTTP 418'), 'p').code, 'UNKNOWN');
  assert.equal(classifyGenericError('weird', 'p').code, 'UNKNOWN');
  const pe = new ProviderError({ code: 'QUOTA_EXHAUSTED', message: 'x', providerId: 'p' });
  assert.equal(classifyGenericError(pe, 'p'), pe);
  assert.ok(!classifyGenericError(new Error(`bad ${KEY}`), 'p', [KEY]).message.includes(KEY));
});

test('redactSecrets ignores empty secrets and handles non-strings', () => {
  assert.equal(redactSecrets('abc', ['', null, undefined]), 'abc');
  assert.equal(redactSecrets(undefined, [KEY]), '');
});

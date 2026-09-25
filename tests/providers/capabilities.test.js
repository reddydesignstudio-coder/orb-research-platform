import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPABILITY_KEYS,
  CapabilityNotVerifiedError,
  defineCapabilities,
  isVerified,
  requireVerified,
  unverified,
  unverifiedKeys,
  verified,
} from '../../supabase/functions/_shared/providers/mod.js';

const allUnverified = () => Object.fromEntries(CAPABILITY_KEYS.map((k) => [k, unverified()]));

test('a provider can declare every capability as TO BE VERIFIED', () => {
  const caps = defineCapabilities({ providerId: 'some_provider', facts: allUnverified() });
  assert.deepEqual(unverifiedKeys(caps), [...CAPABILITY_KEYS]);
  assert.ok(Object.isFrozen(caps) && Object.isFrozen(caps.facts));
});

test('unverified capabilities cannot be relied on', () => {
  const caps = defineCapabilities({ providerId: 'some_provider', facts: allUnverified() });
  for (const key of CAPABILITY_KEYS) {
    assert.equal(isVerified(caps, key), false);
    assert.throws(() => requireVerified(caps, key), CapabilityNotVerifiedError);
  }
  // Even a candidate value noted on an unverified fact cannot be required.
  const withCandidate = defineCapabilities({
    providerId: 'some_provider',
    facts: { ...allUnverified(), pageSize: { verified: false, value: 999, note: 'from a blog post' } },
  });
  assert.throws(() => requireVerified(withCandidate, 'pageSize'), /not verified.*from a blog post/);
});

test('a verified capability needs a source and returns its value', () => {
  assert.throws(() => verified(10, ''), /source/);
  const caps = defineCapabilities({
    providerId: 'some_provider',
    facts: { ...allUnverified(), pageSize: verified(10, 'docs page, checked 2026-10-01') },
  });
  assert.equal(requireVerified(caps, 'pageSize'), 10);
  assert.equal(caps.facts.pageSize.source, 'docs page, checked 2026-10-01');
});

test('declarations must be complete and well-formed', () => {
  const facts = allUnverified();
  delete facts.quota;
  assert.throws(() => defineCapabilities({ providerId: 'p', facts }), /missing capability "quota"/);
  assert.throws(() => defineCapabilities({ providerId: 'p', facts: { ...allUnverified(), extra: unverified() } }), /unknown capability/);
  assert.throws(() => defineCapabilities({ providerId: 'p', facts: { ...allUnverified(), pageSize: { value: 5 } } }), /not a valid fact/);
  assert.throws(() => defineCapabilities({ providerId: 'Bad Id', facts: allUnverified() }), /Invalid provider id/);
});

test('verified values that code computes with are type-checked', () => {
  const bad = (key, value) =>
    assert.throws(() => defineCapabilities({ providerId: 'p', facts: { ...allUnverified(), [key]: verified(value, 'src') } }), /invalid verified value/, key);
  bad('pageSize', 0);
  bad('pageSize', 2.5);
  bad('maxSafeRangeMinutes', -1);
  bad('resultOrder', 'random');
  bad('truncationSignal', 'maybe');
  bad('markets', 'us_stock');
});

test('requireVerified rejects unknown capability names', () => {
  const caps = defineCapabilities({ providerId: 'p', facts: allUnverified() });
  assert.throws(() => requireVerified(caps, 'colour'), /Unknown capability/);
});

/** Answered coverage, missing ranges and checkpoint (TASK 009). Pure functions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkpointOf, mergeCoverage, minutesIn, missingRanges } from '../../supabase/functions/_shared/importer/coverage.js';

const r = (a, b) => ({ start: `2026-09-24T${a}:00.000Z`, end: `2026-09-24T${b}:00.000Z` });
const range = (a, b) => ({ startUtc: `2026-09-24T${a}:00.000Z`, endUtc: `2026-09-24T${b}:00.000Z` });

test('mergeCoverage: sorts, merges overlapping and touching ranges, drops empty ones', () => {
  assert.deepEqual(mergeCoverage([r('12:00', '13:00'), r('10:00', '11:00'), r('11:00', '11:30'), r('12:30', '14:00'), r('09:00', '09:00')]), [
    r('10:00', '11:30'), r('12:00', '14:00'),
  ]);
  assert.deepEqual(mergeCoverage([]), []);
});

test('missingRanges: only the uncovered parts, oldest first', () => {
  const cov = mergeCoverage([r('10:00', '11:00'), r('12:00', '13:00')]);
  assert.deepEqual(missingRanges(range('09:00', '14:00'), cov), [r('09:00', '10:00'), r('11:00', '12:00'), r('13:00', '14:00')]);
  assert.deepEqual(missingRanges(range('10:15', '10:45'), cov), [], 'fully covered');
  assert.deepEqual(missingRanges(range('10:30', '12:30'), cov), [r('11:00', '12:00')]);
  assert.deepEqual(missingRanges(range('15:00', '16:00'), cov), [r('15:00', '16:00')]);
  assert.deepEqual(missingRanges(range('09:00', '10:00'), []), [r('09:00', '10:00')]);
});

test('checkpointOf: end of the first contiguous answered block (holes after it are still missing)', () => {
  assert.equal(checkpointOf([]), null);
  assert.deepEqual(checkpointOf(mergeCoverage([r('10:00', '11:00'), r('11:00', '12:00'), r('13:00', '14:00')])), {
    historyStart: '2026-09-24T10:00:00.000Z',
    checkpoint: '2026-09-24T12:00:00.000Z',
  });
});

test('minutesIn', () => {
  assert.equal(minutesIn([r('10:00', '11:00'), r('12:00', '12:30')]), 90);
});

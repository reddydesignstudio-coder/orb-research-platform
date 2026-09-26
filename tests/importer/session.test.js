/** Research-window filter (TASK 011, D-025): 09:30–11:00 America/New_York, DST-aware. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchWindow } from '../../supabase/functions/_shared/importer/session.js';

const NY = researchWindow({ symbol: 'X', session_timezone: 'America/New_York', session_start: '09:30:00', session_end: '11:00:00' });

test('summer (EDT, UTC−4): 13:30Z–14:59Z inside; 13:29Z and 15:00Z (11:00 ET) outside', () => {
  assert.equal(NY.contains('2026-07-01T13:29:00.000Z'), false);
  assert.equal(NY.contains('2026-07-01T13:30:00.000Z'), true);
  assert.equal(NY.contains('2026-07-01T14:59:00.000Z'), true);
  assert.equal(NY.contains('2026-07-01T15:00:00.000Z'), false, '11:00 is the excluded boundary');
});

test('winter (EST, UTC−5): 14:30Z–15:59Z inside; 13:30Z (08:30 ET) outside', () => {
  assert.equal(NY.contains('2026-01-15T13:30:00.000Z'), false);
  assert.equal(NY.contains('2026-01-15T14:30:00.000Z'), true);
  assert.equal(NY.contains('2026-01-15T15:59:00.000Z'), true);
  assert.equal(NY.contains('2026-01-15T16:00:00.000Z'), false);
});

test('days around the DST changes use the new offset automatically', () => {
  assert.equal(NY.contains('2026-03-06T14:30:00.000Z'), true, 'Fri before spring change: EST');
  assert.equal(NY.contains('2026-03-09T13:30:00.000Z'), true, 'Mon after spring change: EDT');
  assert.equal(NY.contains('2026-03-09T14:59:00.000Z'), true);
  assert.equal(NY.contains('2026-03-09T15:00:00.000Z'), false);
  assert.equal(NY.contains('2026-10-30T13:30:00.000Z'), true, 'Fri before fall change: EDT');
  assert.equal(NY.contains('2026-11-02T14:30:00.000Z'), true, 'Mon after fall change: EST');
  assert.equal(NY.contains('2026-11-02T13:30:00.000Z'), false);
});

test('exactly 90 minutes per day are inside, on normal and DST-change days', () => {
  for (const day of ['2026-07-01', '2026-01-15', '2026-03-08', '2026-03-09', '2026-11-01', '2026-11-02']) {
    let n = 0;
    const start = Date.parse(`${day}T00:00:00Z`);
    for (let m = 0; m < 1440; m++) if (NY.contains(new Date(start + m * 60_000).toISOString())) n++;
    assert.equal(n, 90, day);
  }
});

test('weekends are not filtered out (crypto trades daily; closed markets simply have no candles)', () => {
  assert.equal(NY.contains('2026-09-19T13:30:00.000Z'), true, 'Saturday 09:30 ET');
});

test('no configured window → null; invalid configuration → error, never a silent default', () => {
  assert.equal(researchWindow({ session_timezone: 'UTC', session_start: null, session_end: null }), null);
  assert.throws(() => researchWindow({ session_timezone: 'Mars/Olympus', session_start: '09:30', session_end: '11:00' }), /Unknown session_timezone/);
  assert.throws(() => researchWindow({ session_timezone: 'UTC', session_start: '11:00', session_end: '09:30' }), /after start/);
  assert.equal(NY.label, '09:30–11:00 America/New_York');
});

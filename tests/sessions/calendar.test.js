/** Market calendars (TASK 013, D-028): NYSE holidays, special closures, FX weekdays, crypto daily. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPECIAL_CLOSURES, addDays, easterSunday, marketDay, nyseHolidays, parseDate, weekdayOf,
} from '../../supabase/functions/_shared/sessions/calendar.js';

// Official NYSE holiday table (nyse.com/trade/hours-calendars, read 2026-09-26).
const NYSE_OFFICIAL = {
  2026: ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'],
  2027: ['2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'],
  // 1 Jan 2028 is a Saturday: NYSE does not observe it (the table shows no New Year's Day).
  2028: ['2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19', '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25'],
  // 2025 (history starts 2025-09-26): rule-derived, matches NYSE's published 2025 schedule.
  2025: ['2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25'],
};

for (const [year, dates] of Object.entries(NYSE_OFFICIAL)) {
  test(`NYSE ${year}: the rules produce exactly the official holiday dates`, () => {
    assert.deepEqual([...nyseHolidays(Number(year)).keys()], dates);
  });
}

test('observed-day names are marked; Saturday New Year is not moved to 31 Dec', () => {
  assert.equal(nyseHolidays(2026).get('2026-07-03'), 'Independence Day (observed)');
  assert.equal(nyseHolidays(2027).get('2027-12-24'), 'Christmas Day (observed)');
  assert.equal(nyseHolidays(2027).get('2027-12-31'), undefined);
  assert.equal(nyseHolidays(2023).get('2023-01-02'), "New Year's Day (observed)", '1 Jan 2023 was a Sunday');
});

test('Easter: known dates', () => {
  assert.deepEqual([2025, 2026, 2027, 2028, 2038].map(easterSunday), ['2025-04-20', '2026-04-05', '2027-03-28', '2028-04-16', '2038-04-25']);
});

test('years before the rules are valid are refused, not guessed', () => {
  assert.throws(() => nyseHolidays(2021), RangeError);
});

test('us_stock: weekends, holidays and the 2025-01-09 special closure are closed; early-close days are open', () => {
  assert.deepEqual(marketDay('us_stock', '2026-09-26'), { open: false, reason: 'weekend', calendar: 'nyse' });
  assert.equal(marketDay('us_stock', '2026-11-26').reason, 'holiday');
  assert.equal(marketDay('us_stock', '2026-11-26').name, 'Thanksgiving Day');
  const carter = marketDay('us_stock', '2025-01-09');
  assert.deepEqual([carter.open, carter.reason], [false, 'special_closure']);
  assert.match(carter.name, /Jimmy Carter/);
  assert.ok(SPECIAL_CLOSURES['2025-01-09']);
  for (const early of ['2026-11-27', '2026-12-24']) assert.equal(marketDay('us_stock', early).open, true, `${early} closes 13:00, after the window`);
  assert.equal(marketDay('us_stock', '2026-09-28').open, true);
});

test('forex and gold: weekdays open incl. US holidays; weekends, 25 Dec and 1 Jan closed', () => {
  for (const market of ['forex', 'gold']) {
    assert.equal(marketDay(market, '2026-11-26').open, true, 'Thanksgiving is not an FX closure');
    assert.equal(marketDay(market, '2026-07-03').open, true);
    assert.equal(marketDay(market, '2026-09-26').reason, 'weekend');
    assert.equal(marketDay(market, '2026-09-27').reason, 'weekend');
    assert.deepEqual([marketDay(market, '2025-12-25').open, marketDay(market, '2025-12-25').name], [false, 'Christmas Day']);
    assert.equal(marketDay(market, '2026-01-01').open, false);
    assert.equal(marketDay(market, '2027-12-24').open, true, 'NYSE observes Christmas on 24 Dec 2027; FX does not');
  }
});

test('crypto: open every day, including weekends and holidays', () => {
  for (const d of ['2026-09-26', '2026-09-27', '2025-12-25', '2026-01-01', '2025-01-09']) assert.equal(marketDay('crypto', d).open, true, d);
});

test('unknown market and malformed dates are errors', () => {
  assert.throws(() => marketDay('bonds', '2026-01-05'), /No market calendar/);
  assert.throws(() => marketDay('us_stock', '2026-02-30'), RangeError);
  assert.throws(() => parseDate('2026-1-5'), TypeError);
});

test('date helpers', () => {
  assert.equal(weekdayOf('2026-09-26'), 6);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
});

/**
 * Market calendars (TASK 013, D-028; resolves SR-10).
 *
 * Decides, per market and LOCAL calendar date (in the symbol's session time
 * zone), whether the market is open during the research window. No network,
 * no provider: the calendar is committed code and reviewable.
 *
 *   us_stock → NYSE: closed on weekends, on NYSE full-day holidays (rules below)
 *              and on unscheduled closures listed in SPECIAL_CLOSURES.
 *              Early closes (13:00 ET) do not touch 09:30–11:00 and count as open.
 *   forex    → closed Saturday and Sunday (the FX week runs Sun ~17:00 ET → Fri ~17:00 ET,
 *   gold       so the 09:30–11:00 ET window is inside it on every weekday), and on
 *              25 December and 1 January (global interbank closures). US holidays are
 *              NOT closures for these markets.
 *   crypto   → open every day.
 *
 * NYSE rules (NYSE Rule 7.2 / nyse.com holiday calendar, checked 2026-09-26 for 2026–2028):
 *   New Year's Day      1 Jan; Sunday → Monday; Saturday → not observed (NYSE does not close 31 Dec)
 *   Martin Luther King  3rd Monday of January
 *   Washington's Bday   3rd Monday of February
 *   Good Friday         Friday before Easter Sunday (Gregorian computus)
 *   Memorial Day        last Monday of May
 *   Juneteenth          19 Jun (since 2022); Saturday → Friday, Sunday → Monday
 *   Independence Day    4 Jul; Saturday → Friday, Sunday → Monday
 *   Labor Day           1st Monday of September
 *   Thanksgiving        4th Thursday of November
 *   Christmas           25 Dec; Saturday → Friday, Sunday → Monday
 */

/** Unscheduled full-day NYSE closures. Add new ones here (with the source) when announced. */
export const SPECIAL_CLOSURES = Object.freeze({
  '2025-01-09': 'National Day of Mourning — President Jimmy Carter (ICE/NYSE press release, 2024-12-30)',
});

/** First year the NYSE rules above are valid for (Juneteenth became a holiday in 2022). */
export const NYSE_RULES_FROM_YEAR = 2022;

export const MARKET_CALENDARS = Object.freeze({
  us_stock: 'nyse',
  forex: 'fx_weekdays',
  gold: 'fx_weekdays',
  crypto: 'every_day',
});

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parse 'YYYY-MM-DD' strictly. @returns {{y:number,m:number,d:number}} */
export function parseDate(date) {
  const m = DATE_RE.exec(String(date ?? ''));
  if (!m) throw new TypeError(`Invalid date "${date}" (expected YYYY-MM-DD)`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new RangeError(`Invalid calendar date "${date}"`);
  }
  return { y, m: mo, d };
}

const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** 0 = Sunday … 6 = Saturday (a calendar date has no time zone). */
export function weekdayOf(date) {
  const { y, m, d } = parseDate(date);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Add days to a 'YYYY-MM-DD' date. */
export function addDays(date, days) {
  const { y, m, d } = parseDate(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmtDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Easter Sunday (Gregorian; anonymous / Meeus–Jones–Butcher algorithm). */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fmtDate(year, month, day);
}

/** n-th (1-based) given weekday of a month; n = -1 → last. */
function nthWeekday(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return fmtDate(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return fmtDate(year, month, lastDay - ((last - weekday + 7) % 7));
}

/** Fixed-date holiday observed Sat → Fri, Sun → Mon. */
function observed(year, month, day) {
  const date = fmtDate(year, month, day);
  const wd = weekdayOf(date);
  if (wd === 6) return addDays(date, -1);
  if (wd === 0) return addDays(date, 1);
  return date;
}

const cache = new Map();

/**
 * NYSE full-day holidays of a year (special closures not included).
 * @returns {Map<string, string>} date → holiday name
 */
export function nyseHolidays(year) {
  if (!Number.isInteger(year)) throw new TypeError(`Invalid year "${year}"`);
  if (year < NYSE_RULES_FROM_YEAR) {
    throw new RangeError(`NYSE holiday rules are only defined from ${NYSE_RULES_FROM_YEAR} (asked for ${year})`);
  }
  if (cache.has(year)) return cache.get(year);
  const out = new Map();
  const newYear = fmtDate(year, 1, 1);
  const nyWd = weekdayOf(newYear);
  if (nyWd === 0) out.set(fmtDate(year, 1, 2), "New Year's Day (observed)");
  else if (nyWd !== 6) out.set(newYear, "New Year's Day"); // Saturday: not observed
  out.set(nthWeekday(year, 1, 1, 3), 'Martin Luther King, Jr. Day');
  out.set(nthWeekday(year, 2, 1, 3), "Washington's Birthday");
  out.set(addDays(easterSunday(year), -2), 'Good Friday');
  out.set(nthWeekday(year, 5, 1, -1), 'Memorial Day');
  const tag = (name, y, m, d) => (observed(y, m, d) === fmtDate(y, m, d) ? name : `${name} (observed)`);
  out.set(observed(year, 6, 19), tag('Juneteenth National Independence Day', year, 6, 19));
  out.set(observed(year, 7, 4), tag('Independence Day', year, 7, 4));
  out.set(nthWeekday(year, 9, 1, 1), 'Labor Day');
  out.set(nthWeekday(year, 11, 4, 4), 'Thanksgiving Day');
  out.set(observed(year, 12, 25), tag('Christmas Day', year, 12, 25));
  const frozen = new Map([...out].sort(([a], [b]) => (a < b ? -1 : 1)));
  cache.set(year, frozen);
  return frozen;
}

/**
 * Is the market open on this local date?
 * @param {string} market  symbols.market
 * @param {string} date    'YYYY-MM-DD' in the symbol's session time zone
 * @returns {{ open: boolean, reason: 'open'|'weekend'|'holiday'|'special_closure', name?: string, calendar: string }}
 */
export function marketDay(market, date) {
  const calendar = MARKET_CALENDARS[market];
  if (!calendar) throw new RangeError(`No market calendar for market "${market}"`);
  const { y, m, d } = parseDate(date);
  if (calendar === 'every_day') return { open: true, reason: 'open', calendar };
  const wd = weekdayOf(date);
  if (wd === 0 || wd === 6) return { open: false, reason: 'weekend', calendar };
  if (calendar === 'fx_weekdays') {
    if (m === 12 && d === 25) return { open: false, reason: 'holiday', name: 'Christmas Day', calendar };
    if (m === 1 && d === 1) return { open: false, reason: 'holiday', name: "New Year's Day", calendar };
    return { open: true, reason: 'open', calendar };
  }
  // nyse
  if (SPECIAL_CLOSURES[date]) return { open: false, reason: 'special_closure', name: SPECIAL_CLOSURES[date], calendar };
  const holiday = nyseHolidays(y).get(date);
  if (holiday) return { open: false, reason: 'holiday', name: holiday, calendar };
  return { open: true, reason: 'open', calendar };
}

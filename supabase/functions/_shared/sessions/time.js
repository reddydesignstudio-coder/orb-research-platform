/**
 * Time-zone helpers (TASK 013). Local time always comes from the IANA
 * time-zone database through Intl — never from a fixed UTC offset
 * (RULES.md — TIMEZONE), so EST/EDT and other DST changes are automatic.
 */

const HHMM = /^(\d{2}):(\d{2})(?::00)?$/;

/** 'HH:MM' or 'HH:MM:00' → minutes after local midnight. */
export function minutesOf(time) {
  const m = HHMM.exec(String(time ?? ''));
  if (!m) throw new TypeError(`Invalid session time "${time}" (expected HH:MM)`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || h * 60 + min > 24 * 60) throw new TypeError(`Invalid session time "${time}"`);
  return h * 60 + min;
}

const formatters = new Map();

/** Cached Intl formatter giving local date and time parts in `tz`. Throws RangeError for unknown zones. */
export function zoneFormatter(tz) {
  if (formatters.has(tz)) return formatters.get(tz);
  let fmt;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch {
    throw new RangeError(`Unknown time zone "${tz}"`);
  }
  formatters.set(tz, fmt);
  return fmt;
}

/** Local wall-clock parts of a UTC instant in `tz`. */
export function localParts(msOrIso, tz) {
  const ms = typeof msOrIso === 'number' ? msOrIso : Date.parse(msOrIso);
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid timestamp "${msOrIso}"`);
  const p = Object.fromEntries(zoneFormatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) % 24;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: hour * 60 + Number(p.minute),
    second: Number(p.second),
  };
}

/** Offset of `tz` from UTC at instant `ms`, in minutes (e.g. −240 for EDT). */
function offsetMinutes(ms, tz) {
  const p = Object.fromEntries(zoneFormatter(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * UTC instant (ms) of a local wall-clock time on a local date in `tz`.
 * Throws when the local time does not exist that day (inside a DST gap).
 * For a repeated local time (DST fall-back overlap) the first occurrence is returned.
 */
export function localToUtcMs(date, minutes, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  // Try both candidate offsets (before/after a possible change) and keep the earliest that round-trips.
  const candidates = [...new Set([offsetMinutes(naive - 86_400_000, tz), offsetMinutes(naive, tz), offsetMinutes(naive + 86_400_000, tz)])]
    .map((off) => naive - off * 60_000)
    .filter((ms) => {
      const lp = localParts(ms, tz);
      return lp.date === date && lp.minutes === minutes;
    })
    .sort((a, b) => a - b);
  if (!candidates.length) throw new RangeError(`Local time ${date} ${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')} does not exist in ${tz}`);
  return candidates[0];
}

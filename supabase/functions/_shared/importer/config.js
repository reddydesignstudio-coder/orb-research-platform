/**
 * Importer configuration (committed, reviewable, not secret).
 *
 * HISTORY_START_UTC — the date every enabled symbol's history is built from
 * (owner decision 2026-09-26, D-025: one year back). Changing it later only adds
 * or stops requesting history; stored candles are never removed.
 */
export const HISTORY_START_UTC = '2025-09-26T00:00:00.000Z';

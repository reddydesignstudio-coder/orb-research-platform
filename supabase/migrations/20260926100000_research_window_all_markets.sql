-- ====================================================================
-- Research window for forex, crypto and gold (owner decision 2026-09-26, D-025; closes SR-09)
--
-- Every symbol is researched in the same window as the US stocks:
-- 09:30 → 11:00 America/New_York (11:00 excluded, 90 one-minute candles),
-- so cross-symbol ORB events are compared at the same moments (RELATIONSHIPS.md).
-- The importer stores only candles inside a symbol's window. Days are not
-- restricted: crypto trades every day; closed markets simply have no candles.
--
-- Configuration only: fills sessions that are still undefined (the seed left
-- them null). A session the owner has already set is never overwritten.
-- No candle or other data is changed.
-- ====================================================================

update public.symbols
   set session_timezone = 'America/New_York',
       session_start    = '09:30',
       session_end      = '11:00'
 where market in ('forex', 'crypto', 'gold')
   and session_start is null
   and session_end is null;

comment on column public.symbols.session_start is
  'Start of the research window in session_timezone (inclusive). 09:30 America/New_York for every market (D-025).';

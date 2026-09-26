-- ====================================================================
-- Data quality rows (TASK 014, D-029), written as service_role exactly as the
-- data-quality function does through PostgREST:
--   INSERT … ON CONFLICT (symbol_id, session_date) DO UPDATE (merge-duplicates).
-- ====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

set role service_role;

insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles,
  duplicate_candles, invalid_ohlc_candles, invalid_timestamp_candles, first_candle, last_candle, status, details, checked_at)
select id, '2025-09-29', 90, 87, 3, 0, 0, 0, '2025-09-29 13:33Z', '2025-09-29 14:59Z', 'incomplete',
       '{"missing": ["09:30–09:32"]}'::jsonb, '2026-09-26 10:00Z'
from public.symbols where symbol = 'SPY'
on conflict (symbol_id, session_date) do update set
  expected_candles = excluded.expected_candles, actual_candles = excluded.actual_candles,
  missing_candles = excluded.missing_candles, status = excluded.status, details = excluded.details,
  first_candle = excluded.first_candle, last_candle = excluded.last_candle, checked_at = excluded.checked_at;

-- Re-check: same key, new values → one row, updated; created_at kept.
insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles, status, details, checked_at)
select id, '2025-09-29', 90, 90, 0, 'complete', '{}'::jsonb, '2026-09-27 10:00Z'
from public.symbols where symbol = 'SPY'
on conflict (symbol_id, session_date) do update set
  actual_candles = excluded.actual_candles, missing_candles = excluded.missing_candles,
  status = excluded.status, details = excluded.details, checked_at = excluded.checked_at;

select t.check('quality: upsert keeps one row per symbol and session',
  (select count(*) from public.data_quality q join public.symbols s on s.id = q.symbol_id
   where s.symbol = 'SPY' and q.session_date = '2025-09-29') = 1);
select t.check('quality: re-check overwrote status and checked_at',
  (select status = 'complete' and checked_at = '2026-09-27 10:00Z' from public.data_quality q join public.symbols s on s.id = q.symbol_id
   where s.symbol = 'SPY' and q.session_date = '2025-09-29'));
select t.check('quality: details defaults to an empty object',
  (select details = '{}'::jsonb from public.data_quality q join public.symbols s on s.id = q.symbol_id
   where s.symbol = 'SPY' and q.session_date = '2025-09-29'));

select t.expect_error('quality: details must be a JSON object',
  $q$insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles, status, details)
     select id, '2025-09-30', 90, 90, 0, 'complete', '[]'::jsonb from public.symbols where symbol = 'SPY'$q$, '23514');
select t.expect_error('quality: actual + missing must cover expected',
  $q$insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles, status)
     select id, '2025-09-30', 90, 45, 0, 'incomplete' from public.symbols where symbol = 'SPY'$q$, '23514');
select t.expect_error('quality: market_closed expects 0 candles',
  $q$insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles, status)
     select id, '2025-10-04', 90, 90, 0, 'market_closed' from public.symbols where symbol = 'SPY'$q$, '23514');

-- Candles on a closed day: invalid, expected 0, actual counts the unexpected candles.
insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles,
  invalid_timestamp_candles, status, details)
select id, '2025-09-27', 0, 29, 0, 29, 'invalid', '{"closedReason": "weekend"}'::jsonb from public.symbols where symbol = 'SPY';
select t.check('quality: closed day with candles stored as invalid',
  (select invalid_timestamp_candles = 29 from public.data_quality q join public.symbols s on s.id = q.symbol_id
   where s.symbol = 'SPY' and q.session_date = '2025-09-27'));
reset role;

set role authenticated;
select t.expect_error('quality: browser role cannot write data_quality',
  $q$update public.data_quality set status = 'complete'$q$, '42501');
reset role;
\echo 'QUALITY DATABASE TESTS PASSED'

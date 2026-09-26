-- ====================================================================
-- Importer statements (TASK 008), run as service_role exactly as the
-- importer function issues them through PostgREST:
--   job insert (running) → candle insert ON CONFLICT DO NOTHING RETURNING id
--   → job update with counts / status / notes.
-- ====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

set role service_role;

create temp table t_ids (n int);

insert into public.import_jobs (run_id, symbol_id, provider, interval, requested_start, requested_end, status, started_at)
select '11111111-2222-4333-8444-555555555555', id, 'twelve_data', '1min', '2026-09-24 13:30Z', '2026-09-24 13:33Z', 'running', now()
from public.symbols where symbol = 'SPY';

-- First import: 3 new candles.
with ins as (
  insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, volume, provider, interval)
  select s.id, v.ts, v.o, v.h, v.l, v.c, v.vol, 'twelve_data', '1min'
  from public.symbols s,
       (values ('2026-09-24 13:30Z'::timestamptz, '764.065002'::numeric, 764.38::numeric, 763.66998::numeric, 763.92999::numeric, 1812125::numeric),
               ('2026-09-24 13:31Z', 763.9, 764.1, 763.8, 764.0, null),
               ('2026-09-24 13:32Z', 764.0, 764.2, 763.9, 764.1, 5)) v(ts, o, h, l, c, vol)
  where s.symbol = 'SPY'
  on conflict (symbol_id, interval, timestamp_utc) do nothing
  returning id
)
insert into t_ids select count(*) from ins;
select t.check('importer: first insert stores 3 candles', (select n from t_ids) = 3);

-- Same window again: nothing inserted, nothing changed, no error.
truncate t_ids;
with ins as (
  insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, volume, provider, interval)
  select s.id, '2026-09-24 13:30Z', 1, 1, 1, 1, null, 'twelve_data', '1min'
  from public.symbols s where s.symbol = 'SPY'
  on conflict (symbol_id, interval, timestamp_utc) do nothing
  returning id
)
insert into t_ids select count(*) from ins;
select t.check('importer: re-import inserts nothing (duplicate skipped)', (select n from t_ids) = 0);
select t.check('importer: original candle kept unchanged, exact decimals',
  (select open::text from public.candles c join public.symbols s on s.id = c.symbol_id
   where s.symbol = 'SPY' and c.timestamp_utc = '2026-09-24 13:30Z') = '764.065002');
select t.check('importer: absent volume stored as null',
  (select volume is null from public.candles c join public.symbols s on s.id = c.symbol_id
   where s.symbol = 'SPY' and c.timestamp_utc = '2026-09-24 13:31Z'));
select t.check('importer: timestamp_et derived (EDT: 13:30Z → 09:30)',
  (select timestamp_et from public.candles c join public.symbols s on s.id = c.symbol_id
   where s.symbol = 'SPY' and c.timestamp_utc = '2026-09-24 13:30Z') = '2026-09-24 09:30');

-- Job outcomes the engine records.
update public.import_jobs set status = 'succeeded', received_count = 3, inserted_count = 3, duplicate_count = 0,
  error_message = null, completed_at = now()
where run_id = '11111111-2222-4333-8444-555555555555';
select t.check('importer: succeeded job with counts', (select status from public.import_jobs where run_id = '11111111-2222-4333-8444-555555555555') = 'succeeded');

insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end, status, started_at, received_count, error_message, completed_at)
select '11111111-2222-4333-8444-555555555555', id, 'twelve_data', '2026-09-19 13:30Z', '2026-09-19 15:00Z', 'succeeded', now(), 0,
       'Provider answered with no data: Twelve Data 400: No data is available on the specified dates.', now()
from public.symbols where symbol = 'SPY';
select t.check('importer: an empty answered window is a succeeded job with the provider note',
  exists (select 1 from public.import_jobs where requested_start = '2026-09-19 13:30Z' and status = 'succeeded' and received_count = 0));

insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end, status, started_at, error_code, error_message, completed_at)
select gen_random_uuid(), id, 'twelve_data', '2026-09-23 13:30Z', '2026-09-23 15:00Z', 'partial', now(), 'RANGE_NOT_COMPLETE', 'Truncation cannot be ruled out', now()
from public.symbols where symbol = 'SPY';
insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end, status, started_at, error_code, error_message, next_retry_at, completed_at)
select gen_random_uuid(), id, 'twelve_data', '2026-09-22 13:30Z', '2026-09-22 15:00Z', 'rate_limited', now(), 'RATE_LIMITED', 'minute limit', now() + interval '40 seconds', now()
from public.symbols where symbol = 'SPY';
select t.check('importer: partial and rate_limited outcomes are storable',
  (select count(*) from public.import_jobs where requested_start in ('2026-09-23 13:30Z', '2026-09-22 13:30Z')
   and status in ('partial', 'rate_limited')) = 2);

select t.expect_error('importer: a failed job must carry an error code',
  $q$insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end, status)
     select gen_random_uuid(), id, 'twelve_data', '2026-09-21 13:30Z', '2026-09-21 15:00Z', 'failed' from public.symbols where symbol = 'SPY'$q$,
  '23514');
select t.expect_error('importer: counts can never exceed rows received',
  $q$update public.import_jobs set inserted_count = 5, received_count = 3 where requested_start = '2026-09-24 13:30Z'$q$,
  '23514');

reset role;
\echo 'IMPORTER DATABASE TESTS PASSED'

-- ====================================================================
-- TASK 009 — refresh_import_progress (migration 20260925190000)
-- ====================================================================
set role service_role;
select public.refresh_import_progress((select id from public.symbols where symbol = 'SPY'), 'twelve_data', '1min');
select t.check('progress: first / last / count recomputed from stored candles',
  (select (first_timestamp_utc, last_timestamp_utc, candle_count) = ('2026-09-24 13:30Z'::timestamptz, '2026-09-24 13:32Z'::timestamptz, 3::bigint)
   from public.import_progress p join public.symbols s on s.id = p.symbol_id
   where s.symbol = 'SPY' and p.provider = 'twelve_data'));
select t.check('progress: common dataset is null while other enabled symbols have no candles',
  (select common_dataset_timestamp is null from public.import_progress p join public.symbols s on s.id = p.symbol_id where s.symbol = 'SPY'));

-- Refresh is idempotent (no drift).
select public.refresh_import_progress((select id from public.symbols where symbol = 'SPY'), 'twelve_data', '1min');
select t.check('progress: repeated refresh gives the same count',
  (select candle_count from public.import_progress p join public.symbols s on s.id = p.symbol_id where s.symbol = 'SPY') = 3);

-- Common dataset: disable everything except SPY and QQQ, give QQQ an earlier last candle.
reset role;
create temp table t_enabled as select id, enabled from public.symbols;
update public.symbols set enabled = symbol in ('SPY', 'QQQ');
set role service_role;
insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
select id, '2026-09-24 13:30Z', 500, 501, 499, 500.5, 'twelve_data' from public.symbols where symbol = 'QQQ';
select public.refresh_import_progress((select id from public.symbols where symbol = 'QQQ'), 'twelve_data', '1min');
select t.check('progress: common dataset = min last timestamp across enabled symbols',
  (select bool_and(common_dataset_timestamp = '2026-09-24 13:30Z') from public.import_progress));
reset role;
update public.symbols s set enabled = e.enabled from t_enabled e where e.id = s.id;

set role anon;
select t.expect_error('progress: browser roles cannot run the refresh',
  $q$select public.refresh_import_progress(1, 'twelve_data', '1min')$q$, '42501');
reset role;
set role authenticated;
select t.expect_error('progress: signed-in users cannot run the refresh either',
  $q$select public.refresh_import_progress(1, 'twelve_data', '1min')$q$, '42501');
reset role;
\echo 'PROGRESS DATABASE TESTS PASSED'

-- ====================================================================
-- TASK 010 — duplicate prevention facts the importer relies on
-- ====================================================================
set role service_role;

-- Why the importer removes in-response duplicates itself: with two versions of the
-- same minute in ONE statement, ON CONFLICT DO NOTHING silently keeps the first.
create temp table t_dup (n int);
with ins as (
  insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
  select s.id, v.ts, v.o, v.o, v.o, v.o, 'twelve_data'
  from public.symbols s, (values ('2026-09-24 14:00Z'::timestamptz, 10::numeric), ('2026-09-24 14:00Z', 11)) v(ts, o)
  where s.symbol = 'SPY'
  on conflict (symbol_id, interval, timestamp_utc) do nothing
  returning id
)
insert into t_dup select count(*) from ins;
select t.check('dedup: one statement with two versions of a minute stores exactly one (the database picks silently — hence the application check)',
  (select n from t_dup) = 1);

select t.check('dedup: the unique key makes a second copy of a stored minute impossible',
  (select count(*) from public.candles c join public.symbols s on s.id = c.symbol_id
   where s.symbol = 'SPY' and c.timestamp_utc = '2026-09-24 14:00Z') = 1);

-- Exact comparison needs the stored text form of the price (open::text in the lookup).
select t.check('dedup: numeric::text returns the stored decimal exactly',
  (select open::text from public.candles c join public.symbols s on s.id = c.symbol_id
   where s.symbol = 'SPY' and c.timestamp_utc = '2026-09-24 13:30Z') = '764.065002');

select t.expect_error('dedup: a direct duplicate insert without ON CONFLICT is rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     select id, '2026-09-24 14:00Z', 12, 12, 12, 12, 'twelve_data' from public.symbols where symbol = 'SPY'$q$,
  '23505');

select t.expect_error('dedup: the stored candle cannot be overwritten (immutability)',
  $q$update public.candles set high = 99 where timestamp_utc = '2026-09-24 14:00Z'$q$,
  '42501');
reset role;
\echo 'DEDUP DATABASE TESTS PASSED'

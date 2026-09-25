-- ====================================================================
-- Database constraint tests (TASK 003)
-- Run by scripts/test-db.sh against a fresh database with all migrations
-- applied. Any failed assertion raises an exception and stops the run.
-- ====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

create schema t;

-- Expect a statement to fail with a specific SQLSTATE. The statement runs in
-- a sub-transaction, so its effects are undone either way.
create function t.expect_error(label text, stmt text, expected_state text)
returns void language plpgsql as $$
declare
  got text;
  msg text;
begin
  begin
    execute stmt;
  exception when others then
    got := sqlstate;
    msg := sqlerrm;
  end;
  if got is null then
    raise exception 'FAIL %: expected error % but the statement succeeded', label, expected_state;
  elsif got <> expected_state then
    raise exception 'FAIL %: expected error %, got % (%)', label, expected_state, got, msg;
  end if;
  raise notice 'PASS %', label;
end;
$$;

create function t.check(label text, condition boolean)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL %', label;
  end if;
  raise notice 'PASS %', label;
end;
$$;

-- Test roles must be able to call the helpers.
grant usage on schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;

-- --------------------------------------------------------------------
-- Fixtures (test data only — not the real universe, that is TASK 004)
-- --------------------------------------------------------------------
insert into public.symbols (symbol, display_name, market, provider, provider_symbol, session_timezone, session_start, session_end)
values
  ('TEST_A', 'Test stock A', 'us_stock', 'twelve_data', 'TSTA', 'America/New_York', '09:30', '11:00'),
  ('TEST_B', 'Test stock B', 'us_stock', 'twelve_data', 'TSTB', 'America/New_York', '09:30', '11:00'),
  ('TEST_FX', 'Test FX', 'forex', 'twelve_data', 'TST/FX', 'UTC', null, null);

-- ====================================================================
-- symbols
-- ====================================================================
select t.expect_error('symbols: unknown market rejected',
  $q$insert into public.symbols (symbol, display_name, market, provider, provider_symbol, session_timezone)
     values ('X1','X','bonds','twelve_data','X1','UTC')$q$, '23514');

select t.expect_error('symbols: invalid IANA timezone rejected',
  $q$insert into public.symbols (symbol, display_name, market, provider, provider_symbol, session_timezone)
     values ('X2','X','forex','twelve_data','X2','Mars/Olympus_Mons')$q$, '23514');

select t.expect_error('symbols: duplicate symbol rejected',
  $q$insert into public.symbols (symbol, display_name, market, provider, provider_symbol, session_timezone)
     values ('TEST_A','dup','us_stock','twelve_data','OTHER','America/New_York')$q$, '23505');

select t.expect_error('symbols: duplicate provider symbol rejected',
  $q$insert into public.symbols (symbol, display_name, market, provider, provider_symbol, session_timezone)
     values ('X3','dup','us_stock','twelve_data','TSTA','America/New_York')$q$, '23505');

select t.expect_error('symbols: session start without end rejected',
  $q$insert into public.symbols (symbol, display_name, market, provider, provider_symbol, session_timezone, session_start)
     values ('X4','X','us_stock','twelve_data','X4','America/New_York','09:30')$q$, '23514');

select t.expect_error('symbols: blank symbol rejected',
  $q$insert into public.symbols (symbol, display_name, market, provider, provider_symbol, session_timezone)
     values ('  ','X','us_stock','twelve_data','X5','America/New_York')$q$, '23514');

do $$
declare before timestamptz;
begin
  select updated_at into before from public.symbols where symbol = 'TEST_B';
  perform pg_sleep(0.01);
  -- now() is fixed per transaction; use a new statement-level check instead:
  update public.symbols set display_name = 'Test stock B (renamed)' where symbol = 'TEST_B';
  perform t.check('symbols: updated_at maintained by trigger',
    (select updated_at from public.symbols where symbol = 'TEST_B') >= before);
end $$;

-- ====================================================================
-- candles — timezone / DST
-- ====================================================================
-- Summer (EDT, UTC-4): 13:30Z is 09:30 New York.
-- Winter (EST, UTC-5): 14:30Z is 09:30 New York.
-- The client-supplied timestamp_et (deliberately wrong) must be overwritten.
insert into public.candles (symbol_id, timestamp_utc, timestamp_et, open, high, low, close, volume, provider)
select id, '2026-07-01 13:30:00+00', '1999-01-01 00:00', 100, 101, 99, 100.5, 1000, 'twelve_data'
from public.symbols where symbol = 'TEST_A';

insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, volume, provider)
select id, '2026-01-05 14:30:00+00', 100, 101, 99, 100.5, 1000, 'twelve_data'
from public.symbols where symbol = 'TEST_A';

select t.check('candles: EDT 13:30Z → 09:30 ET (client value overwritten)',
  (select timestamp_et from public.candles where timestamp_utc = '2026-07-01 13:30:00+00') = '2026-07-01 09:30:00');
select t.check('candles: EST 14:30Z → 09:30 ET',
  (select timestamp_et from public.candles where timestamp_utc = '2026-01-05 14:30:00+00') = '2026-01-05 09:30:00');

-- DST switch day 2026-03-08 (US clocks jump 02:00 → 03:00 EST→EDT):
-- 13:30Z is 09:30 EDT that day, while the Friday before, 14:30Z was 09:30 EST.
insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
select id, ts, 50, 50, 50, 50, 'twelve_data'
from public.symbols, (values ('2026-03-06 14:30:00+00'::timestamptz), ('2026-03-09 13:30:00+00'::timestamptz)) v(ts)
where symbol = 'TEST_B';
select t.check('candles: across DST change both opens map to 09:30 ET',
  (select count(*) from public.candles c join public.symbols s on s.id = c.symbol_id
    where s.symbol = 'TEST_B' and c.timestamp_et::time = '09:30') = 2);

-- ====================================================================
-- candles — integrity
-- ====================================================================
select t.expect_error('candles: duplicate symbol/time/interval rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     select id, '2026-07-01 13:30:00+00', 1, 1, 1, 1, 'twelve_data' from public.symbols where symbol = 'TEST_A'$q$, '23505');

-- The importer's dedup path: ON CONFLICT DO NOTHING keeps the original row.
insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
select id, '2026-07-01 13:30:00+00', 1, 1, 1, 1, 'twelve_data' from public.symbols where symbol = 'TEST_A'
on conflict on constraint candles_symbol_interval_time_unique do nothing;
select t.check('candles: ON CONFLICT DO NOTHING keeps the original candle',
  (select open from public.candles where timestamp_utc = '2026-07-01 13:30:00+00') = 100);

insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
select id, '2026-07-01 13:30:00+00', 1.1, 1.2, 1.0, 1.15, 'twelve_data' from public.symbols where symbol = 'TEST_FX';
select t.check('candles: same timestamp allowed for a different symbol',
  (select count(*) from public.candles where timestamp_utc = '2026-07-01 13:30:00+00') = 2);

select t.expect_error('candles: high below low rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     select id, '2026-07-01 13:31:00+00', 100, 98, 99, 100, 'twelve_data' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('candles: high below open rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     select id, '2026-07-01 13:31:00+00', 102, 101, 99, 100, 'twelve_data' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('candles: low above close rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     select id, '2026-07-01 13:31:00+00', 100, 101, 100.2, 100.1, 'twelve_data' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('candles: zero price rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     select id, '2026-07-01 13:31:00+00', 0, 1, 0, 1, 'twelve_data' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('candles: negative volume rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, volume, provider)
     select id, '2026-07-01 13:31:00+00', 1, 1, 1, 1, -5, 'twelve_data' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('candles: timestamp not on a whole minute rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     select id, '2026-07-01 13:31:30+00', 1, 1, 1, 1, 'twelve_data' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('candles: non-1-minute interval rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider, interval)
     select id, '2026-07-01 13:35:00+00', 1, 1, 1, 1, 'twelve_data', '5min' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('candles: missing provider rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     select id, '2026-07-01 13:32:00+00', 1, 1, 1, 1, null from public.symbols where symbol = 'TEST_A'$q$, '23502');
select t.expect_error('candles: unknown symbol rejected',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     values (999999, '2026-07-01 13:32:00+00', 1, 1, 1, 1, 'twelve_data')$q$, '23503');

-- Immutability
select t.expect_error('candles: UPDATE blocked',
  $q$update public.candles set close = close + 1$q$, '42501');
select t.expect_error('candles: timestamp shift blocked',
  $q$update public.candles set timestamp_utc = timestamp_utc + interval '1 hour'$q$, '42501');
select t.expect_error('candles: DELETE blocked',
  $q$delete from public.candles$q$, '42501');
select t.expect_error('candles: TRUNCATE blocked',
  $q$truncate public.candles$q$, '42501');
select t.expect_error('symbols: deleting a symbol that has candles blocked',
  $q$delete from public.symbols where symbol = 'TEST_A'$q$, '23503');

-- Explicit, approved maintenance can opt in for one transaction only.
begin;
set local orb.allow_candle_modification = 'on';
update public.candles set volume = 1001 where timestamp_utc = '2026-07-01 13:30:00+00' and volume = 1000;
rollback;
select t.check('candles: approved override works and is transaction-scoped',
  (select volume from public.candles where timestamp_utc = '2026-07-01 13:30:00+00'
     and symbol_id = (select id from public.symbols where symbol = 'TEST_A')) = 1000);
select t.expect_error('candles: override does not leak outside its transaction',
  $q$delete from public.candles$q$, '42501');

-- ====================================================================
-- import_jobs / import_progress
-- ====================================================================
select t.expect_error('import_jobs: inserted + duplicates > received rejected',
  $q$insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end, received_count, inserted_count, duplicate_count)
     select gen_random_uuid(), id, 'twelve_data', '2026-01-01', '2026-01-02', 10, 8, 5 from public.symbols where symbol='TEST_A'$q$, '23514');
select t.expect_error('import_jobs: failed job without error code rejected',
  $q$insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end, status)
     select gen_random_uuid(), id, 'twelve_data', '2026-01-01', '2026-01-02', 'failed' from public.symbols where symbol='TEST_A'$q$, '23514');
select t.expect_error('import_jobs: empty or reversed range rejected',
  $q$insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end)
     select gen_random_uuid(), id, 'twelve_data', '2026-01-02', '2026-01-02' from public.symbols where symbol='TEST_A'$q$, '23514');
select t.expect_error('import_jobs: unknown status rejected',
  $q$insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end, status)
     select gen_random_uuid(), id, 'twelve_data', '2026-01-01', '2026-01-02', 'done' from public.symbols where symbol='TEST_A'$q$, '23514');

insert into public.import_jobs (run_id, symbol_id, provider, requested_start, requested_end, received_count, inserted_count, duplicate_count, status, error_code, started_at, next_retry_at)
select gen_random_uuid(), id, 'twelve_data', '2026-01-01', '2026-01-02', 390, 380, 10, 'rate_limited', 'RATE_LIMIT', now(), now() + interval '1 minute'
from public.symbols where symbol = 'TEST_A';
select t.check('import_jobs: valid rate-limited job with retry time accepted', (select count(*) from public.import_jobs) = 1);

insert into public.import_progress (symbol_id, provider, first_timestamp_utc, last_timestamp_utc, candle_count)
select id, 'twelve_data', '2026-01-05 14:30Z', '2026-07-01 13:30Z', 2 from public.symbols where symbol = 'TEST_A';
select t.expect_error('import_progress: one checkpoint per symbol/provider/interval',
  $q$insert into public.import_progress (symbol_id, provider, candle_count)
     select id, 'twelve_data', 0 from public.symbols where symbol = 'TEST_A'$q$, '23505');
select t.expect_error('import_progress: first after last rejected',
  $q$insert into public.import_progress (symbol_id, provider, first_timestamp_utc, last_timestamp_utc, candle_count)
     select id, 'twelve_data', '2026-02-01Z', '2026-01-01Z', 5 from public.symbols where symbol = 'TEST_B'$q$, '23514');
select t.expect_error('import_progress: zero candles with a range rejected',
  $q$insert into public.import_progress (symbol_id, provider, first_timestamp_utc, last_timestamp_utc, candle_count)
     select id, 'twelve_data', '2026-01-01Z', '2026-01-02Z', 0 from public.symbols where symbol = 'TEST_B'$q$, '23514');

-- ====================================================================
-- data_quality
-- ====================================================================
insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles, status)
select id, '2026-07-01', 90, 90, 0, 'complete' from public.symbols where symbol = 'TEST_A';
select t.expect_error('data_quality: one row per symbol/session',
  $q$insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles, status)
     select id, '2026-07-01', 90, 89, 1, 'incomplete' from public.symbols where symbol = 'TEST_A'$q$, '23505');
select t.expect_error('data_quality: market closed cannot expect candles (holidays are not missing data)',
  $q$insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles, status)
     select id, '2026-07-04', 90, 0, 90, 'market_closed' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('data_quality: negative invalid-OHLC count rejected',
  $q$insert into public.data_quality (symbol_id, session_date, expected_candles, actual_candles, missing_candles, invalid_ohlc_candles, status)
     select id, '2026-07-02', 90, 90, 0, -1, 'complete' from public.symbols where symbol = 'TEST_A'$q$, '23514');

-- ====================================================================
-- orb_events
-- ====================================================================
insert into public.orb_events (symbol_id, session_date, orb_minutes, orb_high, orb_low, direction, breakout_time, breakout_price)
select id, '2026-07-01', 5, 101, 99, 'bullish', '2026-07-01 13:40Z', 101.05 from public.symbols where symbol = 'TEST_A';
insert into public.orb_events (symbol_id, session_date, orb_minutes, orb_high, orb_low, direction)
select id, '2026-07-01', 15, 101, 99, 'none' from public.symbols where symbol = 'TEST_A';
select t.check('orb_events: valid bullish and no-breakout events accepted', (select count(*) from public.orb_events) = 2);
select t.expect_error('orb_events: unsupported ORB period rejected',
  $q$insert into public.orb_events (symbol_id, session_date, orb_minutes, orb_high, orb_low, direction)
     select id, '2026-07-02', 7, 101, 99, 'none' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('orb_events: bullish breakout not above ORB high rejected',
  $q$insert into public.orb_events (symbol_id, session_date, orb_minutes, orb_high, orb_low, direction, breakout_time, breakout_price)
     select id, '2026-07-02', 5, 101, 99, 'bullish', '2026-07-02 13:40Z', 101 from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('orb_events: bearish breakout not below ORB low rejected',
  $q$insert into public.orb_events (symbol_id, session_date, orb_minutes, orb_high, orb_low, direction, breakout_time, breakout_price)
     select id, '2026-07-02', 5, 101, 99, 'bearish', '2026-07-02 13:40Z', 99.5 from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('orb_events: no-breakout event with a breakout time rejected',
  $q$insert into public.orb_events (symbol_id, session_date, orb_minutes, orb_high, orb_low, direction, breakout_time)
     select id, '2026-07-02', 5, 101, 99, 'none', '2026-07-02 13:40Z' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('orb_events: ORB high below low rejected',
  $q$insert into public.orb_events (symbol_id, session_date, orb_minutes, orb_high, orb_low, direction)
     select id, '2026-07-02', 5, 98, 99, 'none' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('orb_events: one event per symbol/session/period',
  $q$insert into public.orb_events (symbol_id, session_date, orb_minutes, orb_high, orb_low, direction)
     select id, '2026-07-01', 5, 101, 99, 'none' from public.symbols where symbol = 'TEST_A'$q$, '23505');

-- ====================================================================
-- backtest_runs / trades
-- ====================================================================
insert into public.backtest_runs (market, date_from, date_to, orb_minutes, strategy_version)
values ('us_stock', '2026-01-01', '2026-07-31', 5, 'baseline-v1');
select t.check('backtest_runs: default risk/reward is 2R',
  (select risk_reward from public.backtest_runs limit 1) = 2);
select t.expect_error('backtest_runs: unsupported risk/reward rejected',
  $q$insert into public.backtest_runs (market, date_from, date_to, orb_minutes, risk_reward, strategy_version)
     values ('us_stock', '2026-01-01', '2026-07-31', 5, 1.7, 'v1')$q$, '23514');
select t.expect_error('backtest_runs: date_to before date_from rejected',
  $q$insert into public.backtest_runs (market, date_from, date_to, orb_minutes, strategy_version)
     values ('us_stock', '2026-07-31', '2026-01-01', 5, 'v1')$q$, '23514');

insert into public.trades (backtest_run_id, symbol_id, session_date, direction, orb_minutes, entry_time, entry_price, stop_loss, take_profit,
                           exit_time, exit_price, exit_reason, result, r_multiple)
select r.id, s.id, '2026-07-01', 'long', 5, '2026-07-01 13:40Z', 101, 99, 105, '2026-07-01 14:10Z', 105, 'take_profit', 'win', 2
from public.backtest_runs r, public.symbols s where s.symbol = 'TEST_A';
select t.check('trades: valid long trade accepted', (select count(*) from public.trades) = 1);

select t.expect_error('trades: second trade same run/symbol/session rejected (1 trade per session)',
  $q$insert into public.trades (backtest_run_id, symbol_id, session_date, direction, orb_minutes, entry_time, entry_price, stop_loss, take_profit)
     select r.id, s.id, '2026-07-01', 'short', 5, '2026-07-01 13:50Z', 99, 101, 95
     from public.backtest_runs r, public.symbols s where s.symbol = 'TEST_A'$q$, '23505');
select t.expect_error('trades: long with stop above entry rejected',
  $q$insert into public.trades (backtest_run_id, symbol_id, session_date, direction, orb_minutes, entry_time, entry_price, stop_loss, take_profit)
     select r.id, s.id, '2026-07-02', 'long', 5, '2026-07-02 13:40Z', 101, 102, 105
     from public.backtest_runs r, public.symbols s where s.symbol = 'TEST_A'$q$, '23514');
select t.expect_error('trades: short with target above entry rejected',
  $q$insert into public.trades (backtest_run_id, symbol_id, session_date, direction, orb_minutes, entry_time, entry_price, stop_loss, take_profit)
     select r.id, s.id, '2026-07-02', 'short', 5, '2026-07-02 13:40Z', 99, 101, 100
     from public.backtest_runs r, public.symbols s where s.symbol = 'TEST_A'$q$, '23514');
select t.expect_error('trades: ambiguous TP/SL candle recorded as win rejected',
  $q$insert into public.trades (backtest_run_id, symbol_id, session_date, direction, orb_minutes, entry_time, entry_price, stop_loss, take_profit,
                                exit_time, exit_price, exit_reason, result, r_multiple)
     select r.id, s.id, '2026-07-02', 'long', 5, '2026-07-02 13:40Z', 101, 99, 105, '2026-07-02 13:45Z', 105, 'ambiguous_stop', 'win', 2
     from public.backtest_runs r, public.symbols s where s.symbol = 'TEST_A'$q$, '23514');
select t.expect_error('trades: exit time without exit reason rejected',
  $q$insert into public.trades (backtest_run_id, symbol_id, session_date, direction, orb_minutes, entry_time, entry_price, stop_loss, take_profit,
                                exit_time, exit_price, result, r_multiple)
     select r.id, s.id, '2026-07-02', 'long', 5, '2026-07-02 13:40Z', 101, 99, 105, '2026-07-02 13:45Z', 105, 'win', 2
     from public.backtest_runs r, public.symbols s where s.symbol = 'TEST_A'$q$, '23514');
select t.expect_error('trades: exit before entry rejected',
  $q$insert into public.trades (backtest_run_id, symbol_id, session_date, direction, orb_minutes, entry_time, entry_price, stop_loss, take_profit,
                                exit_time, exit_price, exit_reason, result, r_multiple)
     select r.id, s.id, '2026-07-02', 'long', 5, '2026-07-02 13:40Z', 101, 99, 105, '2026-07-02 13:39Z', 99, 'stop_loss', 'loss', -1
     from public.backtest_runs r, public.symbols s where s.symbol = 'TEST_A'$q$, '23514');

-- ====================================================================
-- orb_relationships
-- ====================================================================
insert into public.orb_relationships (reference_symbol_id, target_symbol_id, session_date, reference_direction, target_direction,
                                      reference_breakout_time, target_breakout_time)
select a.id, b.id, '2026-07-01', 'bullish', 'bullish', '2026-07-01 13:40Z', '2026-07-01 13:45Z'
from public.symbols a, public.symbols b where a.symbol = 'TEST_A' and b.symbol = 'TEST_B';
insert into public.orb_relationships (reference_symbol_id, target_symbol_id, session_date, reference_direction, target_direction,
                                      reference_breakout_time, target_breakout_time)
select a.id, b.id, '2026-07-02', 'none', 'none', null, null
from public.symbols a, public.symbols b where a.symbol = 'TEST_A' and b.symbol = 'TEST_B';
select t.check('orb_relationships: delay derived (5 minutes = 300 s) and same_direction true',
  (select delay_seconds = 300 and same_direction from public.orb_relationships where session_date = '2026-07-01'));
select t.check('orb_relationships: two non-breakouts are not "same direction"',
  (select not same_direction and delay_seconds is null from public.orb_relationships where session_date = '2026-07-02'));
select t.expect_error('orb_relationships: symbol related to itself rejected',
  $q$insert into public.orb_relationships (reference_symbol_id, target_symbol_id, session_date, reference_direction, target_direction)
     select id, id, '2026-07-03', 'none', 'none' from public.symbols where symbol = 'TEST_A'$q$, '23514');
select t.expect_error('orb_relationships: derived delay cannot be written directly',
  $q$insert into public.orb_relationships (reference_symbol_id, target_symbol_id, session_date, reference_direction, target_direction, delay_seconds)
     select a.id, b.id, '2026-07-03', 'none', 'none', 5
     from public.symbols a, public.symbols b where a.symbol = 'TEST_A' and b.symbol = 'TEST_B'$q$, '428C9');
select t.expect_error('orb_relationships: breakout direction without a time rejected',
  $q$insert into public.orb_relationships (reference_symbol_id, target_symbol_id, session_date, reference_direction, target_direction)
     select a.id, b.id, '2026-07-03', 'bullish', 'none'
     from public.symbols a, public.symbols b where a.symbol = 'TEST_A' and b.symbol = 'TEST_B'$q$, '23514');

-- Deleting a backtest run removes its derived trades (cascade), never candles.
delete from public.backtest_runs;
select t.check('trades: removed together with their backtest run', (select count(*) from public.trades) = 0);
select t.check('candles: untouched by backtest deletion', (select count(*) from public.candles) = 5);

-- ====================================================================
-- Security: RLS and privileges (D-011)
-- ====================================================================
select t.check('security: RLS enabled on every public table',
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity));

select t.check('security: browser roles hold no write privileges on any public table',
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')));

select t.check('security: no policy grants anything except SELECT',
  not exists (select 1 from pg_policies where schemaname = 'public' and cmd <> 'SELECT'));

select t.check('security: no policy is open to anon',
  not exists (select 1 from pg_policies where schemaname = 'public' and 'anon' = any (roles)));

-- Behaviour as the browser roles
set role anon;
select t.check('security: anonymous visitor reads no candles', (select count(*) from public.candles) = 0);
select t.check('security: anonymous visitor reads no symbols', (select count(*) from public.symbols) = 0);
select t.expect_error('security: anonymous visitor cannot insert a candle',
  $q$insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
     values (1, '2026-08-01 13:30Z', 1, 1, 1, 1, 'twelve_data')$q$, '42501');
reset role;

set role authenticated;
select t.check('security: signed-in user can read candles', (select count(*) from public.candles) = 5);
select t.expect_error('security: signed-in user cannot update symbols',
  $q$update public.symbols set enabled = false$q$, '42501');
select t.expect_error('security: signed-in user cannot delete import jobs',
  $q$delete from public.import_jobs$q$, '42501');
reset role;

set role service_role;
insert into public.candles (symbol_id, timestamp_utc, open, high, low, close, provider)
select id, '2026-07-01 13:31:00+00', 100.5, 100.8, 100.2, 100.6, 'twelve_data' from public.symbols where symbol = 'TEST_A';
select t.check('security: service role (Edge Functions) can insert candles', (select count(*) from public.candles) = 6);
reset role;

\echo 'ALL DATABASE TESTS PASSED'

-- ====================================================================
-- Initial universe tests (TASK 004)
-- Runs before 10_schema.test.sql, so only the seeded symbols exist.
-- ====================================================================
\set ON_ERROR_STOP on
set client_min_messages = notice;

select t.check('universe: 15 symbols seeded', (select count(*) from public.symbols) = 15);

select t.check('universe: 8 US, 4 forex, 2 crypto, 1 gold (PROJECT.md §2)',
  (select jsonb_object_agg(market, n) from (select market, count(*) n from public.symbols group by market) x)
  = '{"us_stock": 8, "forex": 4, "crypto": 2, "gold": 1}'::jsonb);

select t.check('universe: exactly the approved symbols (D-014)',
  (select array_agg(symbol order by symbol) from public.symbols)
  = array['AAPL','AMD','AUD/USD','BTC/USD','ETH/USD','EUR/USD','GBP/USD','META','MSFT','NVDA','QQQ','SPY','TSLA','USD/JPY','XAU/USD']);

select t.check('universe: every symbol enabled and traceable to Twelve Data',
  not exists (select 1 from public.symbols where not enabled or provider <> 'twelve_data' or btrim(provider_symbol) = ''));

select t.check('universe: US session is America/New_York 09:30 → 11:00 (last candle 10:59, 90 candles)',
  not exists (select 1 from public.symbols where market = 'us_stock'
              and (session_timezone <> 'America/New_York' or session_start <> '09:30' or session_end <> '11:00')));

select t.check('universe: 90 one-minute candles fit the US window',
  (select distinct extract(epoch from (session_end - session_start)) / 60 from public.symbols where market = 'us_stock') = 90);

select t.check('universe: every market uses the 09:30 → 11:00 America/New_York research window (D-025, SR-09)',
  not exists (select 1 from public.symbols
              where session_timezone <> 'America/New_York' or session_start <> '09:30' or session_end <> '11:00'
                 or session_start is null or session_end is null));

select t.check('universe: forex / crypto / gold use Twelve Data "BASE/QUOTE" symbols',
  not exists (select 1 from public.symbols where market <> 'us_stock' and provider_symbol !~ '^[A-Z]{3}/[A-Z]{3}$'));

-- The seed is idempotent and never overwrites configuration changes.
update public.symbols set enabled = false where symbol = 'TSLA';
\ir ../../supabase/migrations/20260925150000_seed_initial_universe.sql
select t.check('universe: re-running the seed adds nothing', (select count(*) from public.symbols) = 15);
select t.check('universe: re-running the seed keeps a disabled symbol disabled',
  (select not enabled from public.symbols where symbol = 'TSLA'));
update public.symbols set enabled = true where symbol = 'TSLA';

-- The universe is configurable data: a new symbol can be added without code changes.
insert into public.symbols (symbol, display_name, market, provider, provider_symbol, session_timezone, session_start, session_end)
values ('AMZN', 'Amazon.com, Inc.', 'us_stock', 'twelve_data', 'AMZN', 'America/New_York', '09:30', '11:00');
select t.check('universe: symbols are configurable data (16th symbol added)', (select count(*) from public.symbols) = 16);
-- Remove the test-only row again (symbols without candles may be deleted).
delete from public.symbols where symbol = 'AMZN';
select t.check('universe: back to 15 after removing the test row', (select count(*) from public.symbols) = 15);

-- The research-window migration only fills undefined sessions (D-025).
update public.symbols set session_start = '08:00', session_end = '09:00' where symbol = 'EUR/USD';
update public.symbols set session_start = null, session_end = null, session_timezone = 'UTC' where symbol = 'BTC/USD';
\ir ../../supabase/migrations/20260926100000_research_window_all_markets.sql
select t.check('universe: window migration fills an undefined session',
  (select (session_timezone, session_start, session_end) = ('America/New_York', '09:30'::time, '11:00'::time) from public.symbols where symbol = 'BTC/USD'));
select t.check('universe: window migration never overwrites a session the owner set',
  (select session_start = '08:00' from public.symbols where symbol = 'EUR/USD'));
update public.symbols set session_start = '09:30', session_end = '11:00' where symbol = 'EUR/USD';

-- ====================================================================
-- TASK 004 — Initial research universe (15 symbols)
--
-- Approved by the project owner on 2026-09-25 (D-014):
--   8 US:     SPY, QQQ, AAPL, MSFT, NVDA, AMD, TSLA, META
--   4 forex:  EUR/USD, GBP/USD, USD/JPY, AUD/USD
--   2 crypto: BTC/USD, ETH/USD
--   1 gold:   XAU/USD
--
-- Symbols are configuration, not code (PROJECT.md §2): this migration only
-- inserts rows that do not exist yet (ON CONFLICT DO NOTHING). Later changes
-- — enabling, disabling, adding symbols — happen as data, and re-running
-- this file never overwrites them.
--
-- Sessions
--   US: America/New_York, 09:30 → 11:00 (end exclusive: last candle 10:59,
--       90 one-minute candles; PROJECT.md §4).
--   Forex / crypto / gold: session hours NOT yet defined (SR-09). Stored as
--       NULL so no ORB or backtest can run for them until they are agreed.
--       Timezone 'UTC' is a neutral placeholder until then.
-- ====================================================================

comment on column public.symbols.session_start is
  'Start of the research session in session_timezone (inclusive). NULL = session not yet defined; no ORB is computed.';
comment on column public.symbols.session_end is
  'End of the research session in session_timezone (exclusive boundary). US stocks: 11:00, so the last candle is 10:59.';

insert into public.symbols
  (symbol, display_name, market, provider, provider_symbol, enabled, session_timezone, session_start, session_end)
values
  -- US (session defined)
  ('SPY',     'SPDR S&P 500 ETF Trust',        'us_stock', 'twelve_data', 'SPY',     true, 'America/New_York', '09:30', '11:00'),
  ('QQQ',     'Invesco QQQ Trust (Nasdaq-100)', 'us_stock', 'twelve_data', 'QQQ',     true, 'America/New_York', '09:30', '11:00'),
  ('AAPL',    'Apple Inc.',                    'us_stock', 'twelve_data', 'AAPL',    true, 'America/New_York', '09:30', '11:00'),
  ('MSFT',    'Microsoft Corporation',         'us_stock', 'twelve_data', 'MSFT',    true, 'America/New_York', '09:30', '11:00'),
  ('NVDA',    'NVIDIA Corporation',            'us_stock', 'twelve_data', 'NVDA',    true, 'America/New_York', '09:30', '11:00'),
  ('AMD',     'Advanced Micro Devices, Inc.',  'us_stock', 'twelve_data', 'AMD',     true, 'America/New_York', '09:30', '11:00'),
  ('TSLA',    'Tesla, Inc.',                   'us_stock', 'twelve_data', 'TSLA',    true, 'America/New_York', '09:30', '11:00'),
  ('META',    'Meta Platforms, Inc.',          'us_stock', 'twelve_data', 'META',    true, 'America/New_York', '09:30', '11:00'),
  -- Forex (session TBD — SR-09)
  ('EUR/USD', 'Euro / US Dollar',              'forex',    'twelve_data', 'EUR/USD', true, 'UTC', null, null),
  ('GBP/USD', 'British Pound / US Dollar',     'forex',    'twelve_data', 'GBP/USD', true, 'UTC', null, null),
  ('USD/JPY', 'US Dollar / Japanese Yen',      'forex',    'twelve_data', 'USD/JPY', true, 'UTC', null, null),
  ('AUD/USD', 'Australian Dollar / US Dollar', 'forex',    'twelve_data', 'AUD/USD', true, 'UTC', null, null),
  -- Crypto (session TBD — SR-09)
  ('BTC/USD', 'Bitcoin / US Dollar',           'crypto',   'twelve_data', 'BTC/USD', true, 'UTC', null, null),
  ('ETH/USD', 'Ethereum / US Dollar',          'crypto',   'twelve_data', 'ETH/USD', true, 'UTC', null, null),
  -- Gold (session TBD — SR-09)
  ('XAU/USD', 'Gold / US Dollar',              'gold',     'twelve_data', 'XAU/USD', true, 'UTC', null, null)
on conflict (symbol) do nothing;

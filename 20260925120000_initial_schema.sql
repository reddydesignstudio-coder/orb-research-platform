-- ====================================================================
-- TASK 003 — Initial schema
--
-- Source of truth: DATABASE.md (+ approved additions D-009).
-- Principle: PostgreSQL constraints enforce integrity; application
-- logic alone is not sufficient (DATABASE.md — DATABASE PRINCIPLE).
--
-- Conventions
--   * All instants are timestamptz (stored as UTC).
--   * Prices are numeric (exact; no binary floating point).
--   * Writes happen server-side only (Edge Functions with the service
--     role, which bypasses RLS). Browser roles get read access only,
--     and only when signed in (see RLS section, D-011).
-- ====================================================================


-- --------------------------------------------------------------------
-- Shared trigger functions
-- --------------------------------------------------------------------

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Rejects timezone names PostgreSQL does not know (e.g. typos, 'EST5').
-- A trigger, not a CHECK, because the lookup reads a system view.
create function public.validate_session_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.session_timezone) then
    raise exception 'Unknown session_timezone "%" for symbol %. Use an IANA name such as America/New_York.',
      new.session_timezone, new.symbol
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;


-- --------------------------------------------------------------------
-- symbols — configurable research universe (PROJECT.md §2)
-- --------------------------------------------------------------------

create table public.symbols (
  id                bigint generated always as identity primary key,
  symbol            text        not null,
  display_name      text        not null,
  market            text        not null,
  provider          text        not null,
  provider_symbol   text        not null,
  enabled           boolean     not null default true,
  session_timezone  text        not null,
  session_start     time,       -- null until the market's session is defined (SR-09)
  session_end       time,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint symbols_symbol_unique            unique (symbol),
  constraint symbols_provider_symbol_unique   unique (provider, provider_symbol),
  constraint symbols_symbol_not_blank         check (btrim(symbol) <> ''),
  constraint symbols_display_name_not_blank   check (btrim(display_name) <> ''),
  constraint symbols_provider_symbol_not_blank check (btrim(provider_symbol) <> ''),
  constraint symbols_market_valid             check (market in ('us_stock', 'forex', 'crypto', 'gold')),
  constraint symbols_provider_valid           check (provider ~ '^[a-z][a-z0-9_]*$'),
  constraint symbols_session_both_or_neither  check ((session_start is null) = (session_end is null))
);

comment on table public.symbols is 'Research universe. Symbols are configuration, never hard-coded (PROJECT.md §2).';
comment on column public.symbols.session_timezone is 'IANA timezone name; validated against pg_timezone_names. Never a fixed UTC offset.';

create trigger symbols_set_updated_at
  before update on public.symbols
  for each row execute function public.set_updated_at();

create trigger symbols_validate_timezone
  before insert or update of session_timezone on public.symbols
  for each row execute function public.validate_session_timezone();


-- --------------------------------------------------------------------
-- candles — 1-minute source of truth (RULES.md — DATA)
-- --------------------------------------------------------------------

create table public.candles (
  id             bigint generated always as identity primary key,
  symbol_id      bigint      not null references public.symbols (id) on delete restrict,
  timestamp_utc  timestamptz not null,
  timestamp_et   timestamp   not null,  -- set by trigger from timestamp_utc (D-009 / SR-07)
  open           numeric     not null,
  high           numeric     not null,
  low            numeric     not null,
  close          numeric     not null,
  volume         numeric,              -- null when the provider has no volume (e.g. forex)
  provider       text        not null,
  interval       text        not null default '1min',
  created_at     timestamptz not null default now(),

  -- Uniqueness per DATABASE.md: symbol_id + timestamp_utc + interval.
  -- Column order (symbol_id, interval, timestamp_utc) lets this one index also
  -- serve the two candle lookup indexes in DATABASE.md (D-010).
  constraint candles_symbol_interval_time_unique unique (symbol_id, interval, timestamp_utc),

  constraint candles_interval_valid        check (interval = '1min'),
  constraint candles_minute_aligned        check (mod(extract(epoch from timestamp_utc), 60) = 0),
  constraint candles_prices_positive       check (open > 0 and high > 0 and low > 0 and close > 0),
  constraint candles_high_is_highest       check (high >= open and high >= close and high >= low),
  constraint candles_low_is_lowest         check (low <= open and low <= close),
  constraint candles_volume_non_negative   check (volume is null or volume >= 0),
  constraint candles_provider_valid        check (provider ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.candles is
  'Historical 1-minute candles. Never fabricated or interpolated. Rows are immutable: updates and deletes are blocked by trigger.';
comment on column public.candles.timestamp_et is
  'America/New_York wall-clock time derived from timestamp_utc by the timezone database (DST aware). Informational; timestamp_utc is canonical.';

create index candles_provider_time_idx on public.candles (provider, timestamp_utc);

-- timestamp_et is always derived, never trusted from the client.
create function public.candles_derive_timestamp_et()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.timestamp_et := new.timestamp_utc at time zone 'America/New_York';
  return new;
end;
$$;

create trigger candles_derive_timestamp_et
  before insert on public.candles
  for each row execute function public.candles_derive_timestamp_et();

-- Historical candles are immutable (RULES.md: never shift timestamps, never
-- silently delete; DEPLOYMENT: no destructive operation without approval).
-- An explicitly approved maintenance session may opt in with:
--   set local orb.allow_candle_modification = 'on';
create function public.candles_block_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('orb.allow_candle_modification', true), 'off') <> 'on' then
    raise exception 'Candles are immutable historical data: % is not allowed (candle id %).', tg_op, old.id
      using errcode = 'insufficient_privilege',
            hint = 'Destructive changes need explicit approval (RULES.md — DEPLOYMENT).';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger candles_block_update
  before update on public.candles
  for each row execute function public.candles_block_modification();

create trigger candles_block_delete
  before delete on public.candles
  for each row execute function public.candles_block_modification();

create function public.candles_block_truncate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(current_setting('orb.allow_candle_modification', true), 'off') <> 'on' then
    raise exception 'Candles are immutable historical data: TRUNCATE is not allowed.'
      using errcode = 'insufficient_privilege';
  end if;
  return null;
end;
$$;

create trigger candles_block_truncate
  before truncate on public.candles
  for each statement execute function public.candles_block_truncate();


-- --------------------------------------------------------------------
-- import_jobs — one row per provider request window
-- --------------------------------------------------------------------

create table public.import_jobs (
  id               bigint generated always as identity primary key,
  run_id           uuid        not null,
  symbol_id        bigint      not null references public.symbols (id) on delete restrict,
  provider         text        not null,
  interval         text        not null default '1min',
  requested_start  timestamptz not null,
  requested_end    timestamptz not null,
  received_count   integer     not null default 0,
  inserted_count   integer     not null default 0,
  duplicate_count  integer     not null default 0,
  status           text        not null default 'pending',
  error_code       text,
  error_message    text,
  started_at       timestamptz,
  completed_at     timestamptz,
  next_retry_at    timestamptz,

  constraint import_jobs_interval_valid       check (interval = '1min'),
  constraint import_jobs_range_valid          check (requested_end > requested_start),
  constraint import_jobs_counts_non_negative  check (received_count >= 0 and inserted_count >= 0 and duplicate_count >= 0),
  constraint import_jobs_counts_consistent    check (inserted_count + duplicate_count <= received_count),
  constraint import_jobs_status_valid         check (status in ('pending', 'running', 'succeeded', 'partial', 'failed', 'rate_limited')),
  constraint import_jobs_failure_has_code     check (status not in ('failed', 'rate_limited') or error_code is not null),
  constraint import_jobs_completed_after_start check (completed_at is null or (started_at is not null and completed_at >= started_at)),
  constraint import_jobs_retry_only_when_needed check (next_retry_at is null or status in ('failed', 'rate_limited', 'partial')),
  constraint import_jobs_provider_valid       check (provider ~ '^[a-z][a-z0-9_]*$')
);

comment on table public.import_jobs is 'Every provider request is recorded, including failures (RULES.md — IMPORTER).';

create index import_jobs_run_idx on public.import_jobs (run_id);
create index import_jobs_symbol_status_idx on public.import_jobs (symbol_id, status);
create index import_jobs_retry_idx on public.import_jobs (next_retry_at) where next_retry_at is not null;


-- --------------------------------------------------------------------
-- import_progress — checkpoint per symbol / provider / interval
-- --------------------------------------------------------------------

create table public.import_progress (
  symbol_id                 bigint      not null references public.symbols (id) on delete restrict,
  provider                  text        not null,
  interval                  text        not null default '1min',
  first_timestamp_utc       timestamptz,
  last_timestamp_utc        timestamptz,
  candle_count              bigint      not null default 0,
  common_dataset_timestamp  timestamptz,
  updated_at                timestamptz not null default now(),

  constraint import_progress_pk               primary key (symbol_id, provider, interval),
  constraint import_progress_interval_valid   check (interval = '1min'),
  constraint import_progress_range_valid      check (first_timestamp_utc is null or last_timestamp_utc is null or first_timestamp_utc <= last_timestamp_utc),
  constraint import_progress_range_both_or_neither check ((first_timestamp_utc is null) = (last_timestamp_utc is null)),
  constraint import_progress_count_non_negative check (candle_count >= 0),
  constraint import_progress_empty_has_no_range check (candle_count > 0 or first_timestamp_utc is null)
);

comment on column public.import_progress.common_dataset_timestamp is
  'Minimum last_timestamp_utc across enabled symbols at the time of update (PROJECT.md §8).';

create trigger import_progress_set_updated_at
  before update on public.import_progress
  for each row execute function public.set_updated_at();


-- --------------------------------------------------------------------
-- data_quality — one row per symbol and session
-- --------------------------------------------------------------------

create table public.data_quality (
  id                         bigint generated always as identity primary key,
  symbol_id                  bigint      not null references public.symbols (id) on delete restrict,
  session_date               date        not null,
  expected_candles           integer     not null,
  actual_candles             integer     not null,
  missing_candles            integer     not null,
  duplicate_candles          integer     not null default 0,
  invalid_ohlc_candles       integer     not null default 0,  -- D-009 / SR-05
  invalid_timestamp_candles  integer     not null default 0,  -- D-009 / SR-05
  first_candle               timestamptz,
  last_candle                timestamptz,
  status                     text        not null,
  created_at                 timestamptz not null default now(),

  constraint data_quality_symbol_session_unique unique (symbol_id, session_date),
  constraint data_quality_counts_non_negative check (
    expected_candles >= 0 and actual_candles >= 0 and missing_candles >= 0 and duplicate_candles >= 0
    and invalid_ohlc_candles >= 0 and invalid_timestamp_candles >= 0),
  constraint data_quality_missing_consistent check (missing_candles <= expected_candles),
  constraint data_quality_candle_range_valid check (first_candle is null or last_candle is null or first_candle <= last_candle),
  constraint data_quality_status_valid check (status in ('complete', 'incomplete', 'invalid', 'no_data', 'market_closed')),
  constraint data_quality_closed_expects_nothing check (status <> 'market_closed' or expected_candles = 0)
);

comment on column public.data_quality.status is
  'complete | incomplete (missing candles) | invalid (bad OHLC/timestamps/duplicates) | no_data | market_closed (weekend/holiday: not missing data).';


-- --------------------------------------------------------------------
-- orb_events — ORB levels and first breakout per session and period
-- --------------------------------------------------------------------

create table public.orb_events (
  id              bigint generated always as identity primary key,
  symbol_id       bigint      not null references public.symbols (id) on delete restrict,
  session_date    date        not null,
  orb_minutes     smallint    not null,
  orb_high        numeric     not null,
  orb_low         numeric     not null,
  direction       text        not null,
  breakout_time   timestamptz,
  breakout_price  numeric,
  created_at      timestamptz not null default now(),

  constraint orb_events_symbol_session_period_unique unique (symbol_id, session_date, orb_minutes),
  constraint orb_events_minutes_valid   check (orb_minutes in (1, 3, 5, 10, 15)),
  constraint orb_events_range_valid     check (orb_low > 0 and orb_high >= orb_low),
  constraint orb_events_direction_valid check (direction in ('bullish', 'bearish', 'none')),
  constraint orb_events_breakout_fields check (
    (direction = 'none' and breakout_time is null and breakout_price is null)
    or (direction <> 'none' and breakout_time is not null and breakout_price is not null)),
  constraint orb_events_bullish_above   check (direction <> 'bullish' or breakout_price > orb_high),
  constraint orb_events_bearish_below   check (direction <> 'bearish' or breakout_price < orb_low)
);


-- --------------------------------------------------------------------
-- backtest_runs
-- --------------------------------------------------------------------

create table public.backtest_runs (
  id                bigint generated always as identity primary key,
  market            text        not null,
  date_from         date        not null,
  date_to           date        not null,
  orb_minutes       smallint    not null,
  risk_reward       numeric     not null default 2,
  strategy_version  text        not null,
  status            text        not null default 'pending',
  created_at        timestamptz not null default now(),

  constraint backtest_runs_market_valid       check (market in ('us_stock', 'forex', 'crypto', 'gold', 'all')),
  constraint backtest_runs_dates_valid        check (date_to >= date_from),
  constraint backtest_runs_minutes_valid      check (orb_minutes in (1, 3, 5, 10, 15)),
  constraint backtest_runs_rr_valid           check (risk_reward in (1, 1.5, 2, 2.5, 3)),
  constraint backtest_runs_version_not_blank  check (btrim(strategy_version) <> ''),
  constraint backtest_runs_status_valid       check (status in ('pending', 'running', 'completed', 'failed'))
);

comment on column public.backtest_runs.strategy_version is
  'Identifies the exact methodology used, so historical results stay reproducible (PROJECT.md §15).';


-- --------------------------------------------------------------------
-- trades — at most one per symbol/session per run (ORB_SPEC.md)
-- --------------------------------------------------------------------

create table public.trades (
  id               bigint generated always as identity primary key,
  backtest_run_id  bigint      not null references public.backtest_runs (id) on delete cascade,
  symbol_id        bigint      not null references public.symbols (id) on delete restrict,
  session_date     date        not null,
  direction        text        not null,
  orb_minutes      smallint    not null,
  entry_time       timestamptz not null,
  entry_price      numeric     not null,
  stop_loss        numeric     not null,
  take_profit      numeric     not null,
  exit_time        timestamptz,
  exit_price       numeric,
  exit_reason      text,        -- D-009 / SR-06
  result           text,
  r_multiple       numeric,
  created_at       timestamptz not null default now(),  -- D-009 / SR-06

  constraint trades_one_per_symbol_session unique (backtest_run_id, symbol_id, session_date),
  constraint trades_direction_valid   check (direction in ('long', 'short')),
  constraint trades_minutes_valid     check (orb_minutes in (1, 3, 5, 10, 15)),
  constraint trades_prices_positive   check (entry_price > 0 and stop_loss > 0 and take_profit > 0 and (exit_price is null or exit_price > 0)),
  constraint trades_long_levels       check (direction <> 'long'  or (stop_loss < entry_price and entry_price < take_profit)),
  constraint trades_short_levels      check (direction <> 'short' or (take_profit < entry_price and entry_price < stop_loss)),
  constraint trades_exit_after_entry  check (exit_time is null or exit_time >= entry_time),
  constraint trades_exit_reason_valid check (exit_reason is null or exit_reason in ('take_profit', 'stop_loss', 'time_exit', 'ambiguous_stop')),
  constraint trades_result_valid      check (result is null or result in ('win', 'loss', 'breakeven')),
  constraint trades_closed_fields     check (
    (exit_time is null and exit_price is null and exit_reason is null and result is null and r_multiple is null)
    or (exit_time is not null and exit_price is not null and exit_reason is not null and result is not null and r_multiple is not null)),
  -- ORB_SPEC.md — SAME-CANDLE CONFLICT: ambiguous candles are never a win.
  constraint trades_ambiguous_is_loss check (exit_reason is distinct from 'ambiguous_stop' or result = 'loss')
);

comment on column public.trades.exit_reason is
  'take_profit | stop_loss | time_exit | ambiguous_stop (TP and SL in the same candle; recorded as a loss per ORB_SPEC.md).';

create index trades_symbol_session_idx on public.trades (symbol_id, session_date);


-- --------------------------------------------------------------------
-- orb_relationships — historical association, not causation
-- --------------------------------------------------------------------

create table public.orb_relationships (
  id                        bigint generated always as identity primary key,
  reference_symbol_id       bigint      not null references public.symbols (id) on delete restrict,
  target_symbol_id          bigint      not null references public.symbols (id) on delete restrict,
  session_date              date        not null,
  reference_direction       text        not null,
  target_direction          text        not null,
  reference_breakout_time   timestamptz,
  target_breakout_time      timestamptz,
  -- Derived columns: cannot disagree with the values they describe.
  delay_seconds             integer generated always as
                              (extract(epoch from (target_breakout_time - reference_breakout_time))::integer) stored,
  same_direction            boolean generated always as
                              (reference_direction = target_direction and reference_direction <> 'none') stored,
  created_at                timestamptz not null default now(),

  constraint orb_relationships_distinct_symbols check (reference_symbol_id <> target_symbol_id),
  constraint orb_relationships_ref_direction_valid check (reference_direction in ('bullish', 'bearish', 'none')),
  constraint orb_relationships_tgt_direction_valid check (target_direction in ('bullish', 'bearish', 'none')),
  constraint orb_relationships_ref_time_matches check ((reference_direction = 'none') = (reference_breakout_time is null)),
  constraint orb_relationships_tgt_time_matches check ((target_direction = 'none') = (target_breakout_time is null))
);

comment on table public.orb_relationships is
  'Cross-symbol ORB event pairs. Describes historical association only; never causation (RELATIONSHIPS.md).';

create index orb_relationships_pair_session_idx
  on public.orb_relationships (reference_symbol_id, target_symbol_id, session_date);


-- --------------------------------------------------------------------
-- Row Level Security (D-011)
--
-- RLS is enabled on every table. There are NO insert/update/delete
-- policies: browser roles can never write. Edge Functions write with the
-- service role, which bypasses RLS.
--
-- Read access is granted to signed-in users only ("authenticated").
-- Anonymous visitors of the public website read nothing until access
-- rules are decided with authentication (SR-14). Nothing is exposed by
-- default — including provider data that may not be redistributable.
-- --------------------------------------------------------------------

alter table public.symbols            enable row level security;
alter table public.candles            enable row level security;
alter table public.import_jobs        enable row level security;
alter table public.import_progress    enable row level security;
alter table public.data_quality       enable row level security;
alter table public.orb_events         enable row level security;
alter table public.backtest_runs      enable row level security;
alter table public.trades             enable row level security;
alter table public.orb_relationships  enable row level security;

create policy symbols_read_authenticated           on public.symbols           for select to authenticated using (true);
create policy candles_read_authenticated           on public.candles           for select to authenticated using (true);
create policy import_jobs_read_authenticated       on public.import_jobs       for select to authenticated using (true);
create policy import_progress_read_authenticated   on public.import_progress   for select to authenticated using (true);
create policy data_quality_read_authenticated      on public.data_quality      for select to authenticated using (true);
create policy orb_events_read_authenticated        on public.orb_events        for select to authenticated using (true);
create policy backtest_runs_read_authenticated     on public.backtest_runs     for select to authenticated using (true);
create policy trades_read_authenticated            on public.trades            for select to authenticated using (true);
create policy orb_relationships_read_authenticated on public.orb_relationships for select to authenticated using (true);

-- Defence in depth: browser roles hold no write privileges at all,
-- so a mistaken future policy still cannot enable writes.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on function public.set_updated_at(), public.validate_session_timezone(),
  public.candles_derive_timestamp_et(), public.candles_block_modification(),
  public.candles_block_truncate() from anon, authenticated, public;

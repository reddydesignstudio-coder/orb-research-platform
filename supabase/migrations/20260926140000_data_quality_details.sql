-- ====================================================================
-- TASK 014 — Data quality engine (D-029)
--
-- data_quality keeps one row per symbol and session date (unique already).
-- The engine re-computes a row whenever it checks a session and upserts it,
-- so two columns are added:
--   checked_at  when the row was last computed (created_at keeps the first time)
--   details     what the counts do not show: the session's UTC window, why a
--               market was closed, which minutes are missing (New York time
--               ranges), and any invalid timestamps / OHLC — so the Data page
--               can explain every number without re-reading candles.
-- Additive only; no existing data is changed.
-- ====================================================================

alter table public.data_quality
  add column checked_at timestamptz not null default now(),
  add column details    jsonb       not null default '{}'::jsonb;

alter table public.data_quality
  add constraint data_quality_details_is_object check (jsonb_typeof(details) = 'object'),
  add constraint data_quality_counts_consistent check (actual_candles + missing_candles >= expected_candles);

comment on column public.data_quality.checked_at is 'When the data quality engine last computed this row (TASK 014).';
comment on column public.data_quality.details is
  'Explanation of the counts (TASK 014, D-029): window (UTC), closedReason, missing (New York time ranges), invalidTimestamps, invalidOhlc.';

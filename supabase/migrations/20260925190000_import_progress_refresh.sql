-- ====================================================================
-- TASK 009 — import_progress refresh (D-023)
--
-- import_progress is the per-symbol history summary shown in Admin
-- (PROJECT.md §8): first / last stored candle and candle count per
-- symbol / provider / interval, plus the common dataset timestamp —
-- the minimum last timestamp across ENABLED symbols (null until every
-- enabled symbol has candles from its configured provider).
--
-- It is always recomputed from the stored candles, never incremented,
-- so it cannot drift. The resume point of the importer is NOT taken from
-- here: it comes from definitively answered import jobs (PROVIDERS.md §6.1).
--
-- Additive only: one new function; no table, column or data is changed.
-- ====================================================================

create function public.refresh_import_progress(p_symbol_id bigint, p_provider text, p_interval text default '1min')
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into public.import_progress as ip (symbol_id, provider, interval, first_timestamp_utc, last_timestamp_utc, candle_count)
  select p_symbol_id, p_provider, p_interval, min(c.timestamp_utc), max(c.timestamp_utc), count(*)
  from public.candles c
  where c.symbol_id = p_symbol_id and c.provider = p_provider and c.interval = p_interval
  on conflict (symbol_id, provider, interval) do update
    set first_timestamp_utc = excluded.first_timestamp_utc,
        last_timestamp_utc  = excluded.last_timestamp_utc,
        candle_count        = excluded.candle_count;

  -- Common dataset: min(last) over enabled symbols, each with its configured provider.
  update public.import_progress p
     set common_dataset_timestamp = c.common
    from (
      select case when bool_or(ip.last_timestamp_utc is null) then null
                  else min(ip.last_timestamp_utc) end as common
      from public.symbols s
      left join public.import_progress ip
        on ip.symbol_id = s.id and ip.provider = s.provider and ip.interval = p_interval
      where s.enabled
    ) c
   where p.interval = p_interval
     and p.common_dataset_timestamp is distinct from c.common;
end;
$$;

comment on function public.refresh_import_progress(bigint, text, text) is
  'Recompute import_progress for one symbol/provider/interval from stored candles, and the common dataset timestamp (PROJECT.md §8). Server-side only.';

-- Server-side only: browser roles may not call it.
revoke all on function public.refresh_import_progress(bigint, text, text) from public, anon, authenticated;
grant execute on function public.refresh_import_progress(bigint, text, text) to service_role;

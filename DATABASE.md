# DATABASE SPECIFICATION

## symbols

```text
id
symbol
display_name
market
provider
provider_symbol
enabled
session_timezone
session_start
session_end
created_at
updated_at
```

---

## candles

```text
id
symbol_id
timestamp_utc
timestamp_et
open
high
low
close
volume
provider
interval
created_at
```

Unique:

```text
symbol_id + timestamp_utc + interval
```

---

## import_jobs

```text
id
run_id
symbol_id
provider
interval
requested_start
requested_end
received_count
inserted_count
duplicate_count
status
error_code
error_message
started_at
completed_at
next_retry_at
```

---

## import_progress

```text
symbol_id
provider
interval
first_timestamp_utc
last_timestamp_utc
candle_count
common_dataset_timestamp
updated_at
```

---

## data_quality

```text
id
symbol_id
session_date
expected_candles
actual_candles
missing_candles
duplicate_candles
first_candle
last_candle
status
created_at
```

---

## orb_events

```text
id
symbol_id
session_date
orb_minutes
orb_high
orb_low
direction
breakout_time
breakout_price
created_at
```

---

## backtest_runs

```text
id
market
date_from
date_to
orb_minutes
risk_reward
strategy_version
status
created_at
```

---

## trades

```text
id
backtest_run_id
symbol_id
session_date
direction
orb_minutes
entry_time
entry_price
stop_loss
take_profit
exit_time
exit_price
result
r_multiple
```

---

## orb_relationships

```text
id
reference_symbol_id
target_symbol_id
session_date
reference_direction
target_direction
reference_breakout_time
target_breakout_time
delay_seconds
same_direction
created_at
```

---

# INDEXES

Create efficient indexes for:

* candles(symbol_id, timestamp_utc)
* candles(symbol_id, interval, timestamp_utc)
* candles(provider, timestamp_utc)
* data_quality(symbol_id, session_date)
* orb_events(symbol_id, session_date, orb_minutes)
* trades(backtest_run_id)
* relationships(reference_symbol_id, target_symbol_id, session_date)

---

# DATABASE PRINCIPLE

Use PostgreSQL constraints to enforce data integrity.

Application logic alone is not sufficient.

---

# APPROVED ADDITIONS (2026-09-25, D-009)

Approved by the project owner (SR-04 – SR-07). Implemented in
`supabase/migrations/20260925120000_initial_schema.sql`.

## data_quality — added

```text
invalid_ohlc_candles
invalid_timestamp_candles
```

## trades — added

```text
exit_reason   take_profit | stop_loss | time_exit | ambiguous_stop
created_at
```

`ambiguous_stop` = TP and SL touched in the same candle; always recorded as a loss (ORB_SPEC.md).

## candles.timestamp_et

Kept for every symbol. Always derived from `timestamp_utc` by the database
(America/New_York, DST-aware); client-supplied values are overwritten.
`timestamp_utc` is canonical.

## Index on relationships

The `relationships(...)` index in INDEXES is created on `orb_relationships`.

---

# IMPLEMENTATION NOTES

* Candle uniqueness is enforced as `unique (symbol_id, interval, timestamp_utc)` — the same
  rule as `symbol_id + timestamp_utc + interval`; this column order also serves both candle
  lookup indexes, so no duplicate index is stored (D-010).
* Candles are immutable: UPDATE, DELETE and TRUNCATE are blocked by trigger. An approved
  maintenance transaction can opt in with `set local orb.allow_candle_modification = 'on'`.
* `orb_relationships.delay_seconds` and `same_direction` are generated columns.
* Row Level Security is enabled on every table; browser roles cannot write; only signed-in
  users can read (D-011).
* Measured storage: about 230 bytes per candle including indexes.
* `refresh_import_progress(symbol_id, provider, interval)` recomputes an `import_progress` row
  from the stored candles and updates `common_dataset_timestamp` (minimum last candle across
  enabled symbols; null until all have candles). Server-side only (D-023).
* The importer's resume point comes from answered `import_jobs` windows, not from
  `import_progress.last_timestamp_utc` (PROVIDERS.md §6.1, D-023).
* Duplicates (D-024): besides the unique key, the importer stores one version per minute only
  when a response is consistent, never overwrites a stored minute, and records
  `CONFLICTING_DUPLICATE` / `REVISED_BY_PROVIDER` warnings on the import job.

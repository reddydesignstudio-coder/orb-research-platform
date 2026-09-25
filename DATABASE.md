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

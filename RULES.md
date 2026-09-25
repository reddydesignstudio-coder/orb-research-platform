# NON-NEGOTIABLE PROJECT RULES

## DATA

1. Historical 1-minute candles are the source of truth.
2. Never fabricate candles.
3. Never interpolate missing candles.
4. Never shift historical timestamps artificially.
5. Never silently discard invalid data.
6. Every candle must have a traceable provider.
7. Prevent duplicate candles at database level.

---

## TIMEZONE

For US stocks:

```text
America/New_York
```

Never use a fixed UTC offset.

ORB opening window:

```text
09:30:00 → 10:59:00 ET
```

Expected:

```text
90 one-minute candles
```

---

## IMPORTER

1. Must be resumable.
2. Must use checkpoints.
3. Must respect provider limits.
4. Must not bypass quotas.
5. Must record failures.
6. Must record provider.
7. Must prevent duplicates.
8. Must balance historical progress across symbols.
9. Must show common dataset progress.

---

## DATA QUALITY

Weekends and market holidays are not missing data.

A session is incomplete only when the market should have been open and expected candles are absent.

---

## ORB

Initial baseline must remain simple.

Do not add indicators unless explicitly requested.

No:

* RSI
* MACD
* VWAP
* ATR
* AI
* machine learning
* news filters
* gap filters
* relative volume

in the baseline.

---

## BACKTEST

Never introduce look-ahead bias.

Do not use future candles to make an entry decision.

Do not use future information unavailable at entry time.

---

## AMBIGUOUS CANDLES

If a candle touches both TP and SL and OHLC data cannot establish sequence:

Do not assume the favorable outcome.

Use a documented conservative convention.

---

## PROVIDERS

Never silently change provider.

Provider source must be recorded.

---

## SECURITY

Never commit:

* API keys
* passwords
* service-role keys
* private credentials

---

## DATABASE

Database is the source of truth.

Do not use browser localStorage as the historical database.

---

## RESEARCH

Do not curve-fit silently.

Do not optimize only for the best result.

Do not claim historical performance guarantees future results.

Do not infer causality from correlation.

---

## DEPLOYMENT

No destructive database operation without explicit approval.

Never delete historical data as part of normal importer operation.

---

## FAIL LOUDLY

If something is wrong:

show it.

Do not hide it.

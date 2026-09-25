# ORB RESEARCH & BACKTESTING PLATFORM

## Project Name

ORB Research & Backtesting Platform

## Purpose

Build a web-based historical research and backtesting platform for Opening Range Breakout (ORB) strategies across:

* US Stocks
* Forex
* Crypto
* Gold / XAUUSD

The system will import historical 1-minute market data, validate the data, calculate ORB events, backtest ORB strategies, analyze performance, and study relationships between ORB events across different symbols.

This is initially a **research and backtesting application**, not a live trading application.

---

# 1. PRIMARY OBJECTIVES

The application must:

1. Import historical 1-minute candles.
2. Store candles in Supabase PostgreSQL.
3. Maintain source/provider traceability.
4. Detect missing and duplicate candles.
5. Validate trading sessions.
6. Handle timezones correctly.
7. Calculate ORB levels.
8. Detect ORB breakouts.
9. Backtest trades.
10. Calculate performance statistics.
11. Analyze performance by symbol, weekday, direction and ORB duration.
12. Analyze relationships between symbols.
13. Provide an Admin/data-management interface.
14. Provide a research dashboard.
15. Be deployable through GitHub Pages + Supabase.
16. Preserve historical research reproducibility.

---

# 2. INITIAL MARKET UNIVERSE

Initial universe:

* 8 US Stocks
* 4 Forex pairs
* 2 Crypto symbols
* 1 Gold/XAUUSD symbol

Total:

15 symbols.

The symbols must be configurable.

Do not hard-code the symbols throughout the application.

---

# 3. SOURCE DATA

Primary source:

Historical 1-minute candles.

The 1-minute dataset is the source of truth.

Higher ORB periods must be derived from the 1-minute candles.

Supported ORB periods:

* 1 minute
* 3 minutes
* 5 minutes
* 10 minutes
* 15 minutes

---

# 4. US STOCK SESSION

US stock ORB research uses:

Timezone:

America/New_York

Opening range session:

09:30:00 ET → 10:59:00 ET

11:00 ET is the boundary and is excluded.

Therefore a complete opening-window dataset contains exactly:

90 one-minute candles.

Never hard-code UTC-5 or UTC-4.

The timezone library must automatically handle EST/EDT.

---

# 5. ARCHITECTURE

Primary architecture:

Browser
↓
GitHub Pages frontend
↓
Supabase Edge Functions
↓
Market Data Provider
↓
Supabase PostgreSQL

The frontend must never contain market-data provider secrets.

---

# 6. PRIMARY DATA PROVIDER

Initial provider:

Twelve Data.

Other providers may be added later:

* Finnhub
* Alpha Vantage
* Financial Modeling Prep

Provider support must use an abstraction layer.

---

# 7. DATA IMPORTER

The application must have an Admin data-import interface.

Primary action:

GET DATA

The importer must:

* determine existing history
* request missing history
* paginate
* deduplicate
* checkpoint progress
* resume after interruption
* respect provider quotas
* respect rate limits
* record errors
* record provider
* maintain balanced progress across symbols

If a provider cannot supply the complete requested range, import what is legitimately available and continue building the dataset over subsequent runs.

Never fabricate missing candles.

---

# 8. BALANCED DATASET

The importer must avoid allowing one symbol to progress far ahead of the others.

Maintain:

Individual history:

last timestamp per symbol.

Common dataset:

minimum last timestamp across enabled symbols.

The Admin UI must display both.

---

# 9. DATA QUALITY

For each US stock session, validate:

* expected candles
* actual candles
* missing candles
* duplicate candles
* first candle
* last candle
* OHLC validity
* timestamp correctness

A complete opening window should contain:

90 candles

from:

09:30

through:

10:59

Weekends and market holidays are not missing data.

---

# 10. BASELINE ORB STRATEGY

The initial strategy is intentionally simple.

For a selected ORB period:

Calculate:

ORB High
ORB Low

Bullish breakout:

price breaks above ORB High.

Bearish breakout:

price breaks below ORB Low.

Use the first valid breakout.

Maximum:

1 trade per symbol/session.

Stop loss:

opposite side of ORB.

Default risk/reward:

1:2.

Time exit:

11:00 ET for US stock baseline research.

---

# 11. BACKTESTING

Backtesting must calculate:

* total trades
* wins
* losses
* win percentage
* net R
* average R
* profit factor
* maximum drawdown
* average win
* average loss
* long trades
* short trades
* average breakout time
* average time to TP
* average time to SL

Results must be filterable by:

* symbol
* market
* weekday
* ORB duration
* direction
* date range

---

# 12. CROSS-SYMBOL RESEARCH

The application must analyze whether ORB events in one symbol are historically associated with ORB events in another symbol.

Metrics include:

* sample size
* same-direction frequency
* opposite-direction frequency
* conditional frequency
* average delay
* median delay
* lead/lag windows

Lead/lag windows:

* 0 minutes
* 1 minute
* 2 minutes
* 3 minutes
* 5 minutes
* 10 minutes
* 15 minutes

This is statistical association research.

Do not claim causality.

---

# 13. INITIAL RESEARCH PHILOSOPHY

Keep the baseline simple.

Do not initially add:

* RSI
* MACD
* VWAP
* ATR
* Bollinger Bands
* gap filters
* news filters
* AI filters
* machine learning
* relative volume
* complex trend filters

Those can be added later as separate research modules.

---

# 14. SECURITY

API keys must be stored only in Supabase Edge Function secrets.

Never expose provider API keys through:

* GitHub
* frontend code
* HTML
* JavaScript
* browser storage
* public configuration

Never expose a Supabase service-role key to the browser.

---

# 15. RESEARCH INTEGRITY

The application must avoid:

* look-ahead bias
* fabricated data
* silent provider switching
* silent timezone changes
* duplicate candles
* hidden methodology changes
* parameter fishing

Historical results must be presented as historical research results.

The application must not make claims about future profitability.

---

# 16. FINAL PRODUCT

The finished application should provide:

### Dashboard

Research overview.

### Data

Historical candle/data health.

### Admin

Import and system management.

### ORB Research

ORB event exploration.

### Backtest

Historical strategy testing.

### Relationships

Cross-symbol ORB analysis.

### Settings

Symbols and research configuration.

The interface must work on:

* desktop
* tablet
* iPhone

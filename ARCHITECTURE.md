# SYSTEM ARCHITECTURE

## 1. HIGH LEVEL

```text
USER
 │
 ▼
GITHUB PAGES
 │
 ▼
FRONTEND
 │
 ▼
SUPABASE EDGE FUNCTIONS
 │
 ├── Market Data Provider
 │
 └── Supabase PostgreSQL
```

---

# 2. FRONTEND

Hosted on:

GitHub Pages

Responsibilities:

* dashboard
* Admin
* data monitoring
* backtest configuration
* results
* relationship analysis
* charts
* tables

The frontend must not contain provider secrets.

---

# 3. SUPABASE

Supabase provides:

* PostgreSQL
* Edge Functions
* secure server-side provider calls
* database API
* authentication if needed

---

# 4. MARKET DATA

Provider abstraction:

```text
MarketDataProvider
│
├── TwelveDataProvider
├── FinnhubProvider
├── AlphaVantageProvider
└── FMPProvider
```

Twelve Data is the initial provider.

---

# 5. DATA FLOW

```text
Admin
 ↓
GET DATA
 ↓
Supabase Edge Function
 ↓
Provider
 ↓
Normalize candles
 ↓
Validate
 ↓
Deduplicate
 ↓
PostgreSQL
 ↓
Update import progress
 ↓
Admin dashboard
```

---

# 6. ORB FLOW

```text
Candles
 ↓
Session validation
 ↓
Opening range
 ↓
ORB High / Low
 ↓
Breakout detection
 ↓
ORB Event
 ↓
Backtest
 ↓
Trade
 ↓
Performance metrics
```

---

# 7. RELATIONSHIP FLOW

```text
ORB Events
 ↓
Reference symbol
 ↓
Target symbol
 ↓
Match session
 ↓
Compare direction
 ↓
Calculate delay
 ↓
Aggregate statistics
 ↓
Relationship dashboard
```

---

# 8. DATABASE

PostgreSQL tables:

```text
symbols
candles
import_jobs
import_progress
data_quality
orb_events
backtest_runs
trades
orb_relationships
```

---

# 9. SECURITY

Public:

* Supabase URL
* Supabase anon key

Private:

* provider API keys
* service-role key

Private credentials must remain server-side.

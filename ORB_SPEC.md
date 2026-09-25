# ORB METHODOLOGY

## SOURCE

1-minute historical candles.

---

# US STOCK SESSION

Timezone:

```text
America/New_York
```

Opening session:

```text
09:30 → 10:59 ET
```

---

# ORB PERIODS

Support:

```text
1
3
5
10
15 minutes
```

---

# ORB HIGH

Maximum high during opening period.

---

# ORB LOW

Minimum low during opening period.

---

# BULLISH BREAKOUT

Price moves above ORB High.

---

# BEARISH BREAKOUT

Price moves below ORB Low.

---

# ENTRY

First valid 1-minute breakout.

The entry convention must be deterministic and documented.

No look-ahead.

---

# STOP LOSS

Long:

```text
ORB Low
```

Short:

```text
ORB High
```

---

# TAKE PROFIT

Default:

```text
2R
```

Allow configurable:

```text
1R
1.5R
2R
2.5R
3R
```

---

# TRADE LIMIT

Maximum:

```text
1 trade per symbol/session
```

---

# TIME EXIT

US stock baseline:

```text
11:00 ET
```

---

# SAME-CANDLE CONFLICT

If both TP and SL are touched in the same candle and sequence cannot be known:

Use a conservative documented rule.

Default:

```text
LOSS
```

---

# RESEARCH

Do not add indicators to the baseline.

Keep the first implementation transparent and reproducible.

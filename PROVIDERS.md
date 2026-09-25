# MARKET DATA PROVIDERS

> **STATUS: PROVISIONAL — ORIGINAL DOCUMENT MISSING**
>
> The `Providers` document uploaded to the Claude Project contained an exact copy of
> `RELATIONSHIPS.md` instead of provider content. The original provider specification
> has not been supplied yet.
>
> Until it is, this file contains **only** provider requirements that are already stated
> elsewhere in the specification (source noted on each line). Nothing below is new
> methodology or a new decision. See `docs/SPEC_REVIEW.md` (issue SR-01).
>
> Replace this file with the original PROVIDERS.md before TASK 005 begins.

---

## INITIAL PROVIDER

Twelve Data. *(PROJECT.md §6, ARCHITECTURE.md §4)*

---

## FUTURE PROVIDERS

* Finnhub
* Alpha Vantage
* Financial Modeling Prep

*(PROJECT.md §6)*

---

## ABSTRACTION

Provider support must use an abstraction layer. *(PROJECT.md §6)*

```text
MarketDataProvider
│
├── TwelveDataProvider
├── FinnhubProvider
├── AlphaVantageProvider
└── FMPProvider
```

*(ARCHITECTURE.md §4)*

---

## DATA

* Historical 1-minute candles are the source of truth. *(RULES.md — DATA)*
* Every candle must have a traceable provider. *(RULES.md — DATA)*
* If a provider cannot supply the complete requested range, import what is legitimately available and continue over subsequent runs. *(PROJECT.md §7)*
* Never fabricate missing candles. *(PROJECT.md §7)*

---

## LIMITS

* Respect provider quotas and rate limits. *(PROJECT.md §7, RULES.md — IMPORTER)*
* Must not bypass quotas. *(RULES.md — IMPORTER)*

---

## PROVIDER SWITCHING

* Never silently change provider. *(RULES.md — PROVIDERS)*
* Provider source must be recorded. *(RULES.md — PROVIDERS)*

---

## SECRETS

* Provider API keys are stored only in Supabase Edge Function secrets. *(PROJECT.md §14, CLAUDE.md — SECURITY)*
* Provider calls happen server-side in Supabase Edge Functions; the frontend never contains provider secrets. *(ARCHITECTURE.md §2–3, §9)*

# supabase/

Server side of the platform.

| Path | Purpose | First task |
|------|---------|-----------|
| `migrations/` | PostgreSQL schema migrations (tables, constraints, indexes, RLS) per `DATABASE.md` | TASK 003 |
| `functions/` | Edge Functions for provider access and importing | TASK 007 |

Secrets (provider API keys, service-role key) are set as **Supabase Edge Function secrets**
through the Supabase dashboard or CLI. They are never written into this folder.

`migrations/` and `functions/` contain only a `.gitkeep` for now, because the Supabase CLI
treats files in those folders as migrations and functions.

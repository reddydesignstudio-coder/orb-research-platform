-- ====================================================================
-- TEST-ONLY bootstrap for a plain PostgreSQL database.
--
-- Recreates the parts of Supabase the migrations rely on, so the schema
-- can be tested in CI (postgres service container) and locally.
-- NEVER applied to the real Supabase project — Supabase already has these.
-- ====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;

-- Supabase grants browser roles full table privileges by default and relies
-- on RLS (and our explicit REVOKEs) for protection. Mirror that here so the
-- tests prove the migration's revokes and policies actually do the work.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

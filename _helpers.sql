-- ====================================================================
-- Shared assertion helpers for tests/db/*.test.sql.
-- Applied once by scripts/test-db.sh after the migrations, before the tests.
-- ====================================================================
\set ON_ERROR_STOP on

create schema t;

-- Expect a statement to fail with a specific SQLSTATE. The statement runs in
-- a sub-transaction, so its effects are undone either way.
create function t.expect_error(label text, stmt text, expected_state text)
returns void language plpgsql as $$
declare
  got text;
  msg text;
begin
  begin
    execute stmt;
  exception when others then
    got := sqlstate;
    msg := sqlerrm;
  end;
  if got is null then
    raise exception 'FAIL %: expected error % but the statement succeeded', label, expected_state;
  elsif got <> expected_state then
    raise exception 'FAIL %: expected error %, got % (%)', label, expected_state, got, msg;
  end if;
  raise notice 'PASS %', label;
end;
$$;

create function t.check(label text, condition boolean)
returns void language plpgsql as $$
begin
  if condition is distinct from true then
    raise exception 'FAIL %', label;
  end if;
  raise notice 'PASS %', label;
end;
$$;

-- Test roles must be able to call the helpers.
grant usage on schema t to anon, authenticated, service_role;
grant execute on all functions in schema t to anon, authenticated, service_role;


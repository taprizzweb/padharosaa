-- 0001_baseline_privileges
-- Locks the `public` schema down BEFORE any table exists, so nothing created later is
-- reachable by anon/authenticated unless a later migration grants it explicitly.
-- Idempotent: safe to re-run.
-- Rollback: this migration only removes privileges. To undo, GRANT them back (not recommended).

create schema if not exists private;

-- `private` holds helper functions used by RLS policies. It is not exposed through the API.
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;

-- Nobody reaches public objects by default.
revoke all on schema public from public;
revoke all on schema public from anon;
grant usage on schema public to authenticated, service_role;

revoke all on all tables    in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

-- Future objects created by the migration role are NOT auto-granted.
alter default privileges in schema public revoke all on tables    from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges in schema public revoke all on functions from public, anon, authenticated, service_role;
alter default privileges in schema private revoke all on functions from public, anon, authenticated;
-- Functions are executable by PUBLIC by default in Postgres; turn that off globally for this role.
alter default privileges revoke execute on functions from public;

-- On Supabase, objects may also be created by supabase_admin; mirror the defaults when allowed.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    begin
      alter default privileges for role supabase_admin in schema public
        revoke all on tables from public, anon, authenticated, service_role;
      alter default privileges for role supabase_admin in schema public
        revoke all on sequences from public, anon, authenticated, service_role;
      alter default privileges for role supabase_admin in schema public
        revoke all on functions from public, anon, authenticated, service_role;
    exception when insufficient_privilege then
      raise notice 'could not alter supabase_admin default privileges (ok on hosted projects, run once via dashboard if needed)';
    end;
  end if;
end $$;

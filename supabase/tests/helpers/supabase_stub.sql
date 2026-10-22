-- Minimal stand-in for the parts of Supabase our migrations depend on.
-- NOT a migration: only used by the local/CI test database.

-- Roles are cluster-wide and test files run in parallel, so tolerate "already exists" races.
do $$ begin
  begin create role anon nologin noinherit; exception when duplicate_object or unique_violation then null; end;
  begin create role authenticated nologin noinherit; exception when duplicate_object or unique_violation then null; end;
  begin create role service_role nologin noinherit bypassrls; exception when duplicate_object or unique_violation then null; end;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);
-- test-only extras so the local stand-in can store passwords and server-only metadata
alter table auth.users add column if not exists password text;
alter table auth.users add column if not exists app_metadata jsonb not null default '{}'::jsonb;
-- Same lookup order as Supabase: claims JSON, falling back to the legacy per-claim setting.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
-- test-only second-factor storage for the local Auth stand-in
create table if not exists auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  factor_type text not null default 'totp',
  status text not null default 'unverified',
  secret text not null,
  created_at timestamptz not null default now()
);
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text, owner uuid, created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

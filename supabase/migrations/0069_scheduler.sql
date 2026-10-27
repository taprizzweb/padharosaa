-- 0069_scheduler
-- A clock for the app. The daily buffet reminder (and the WhatsApp outbox) are sent by /api/padharosaa/v1/cron/notify, but nothing was calling it.
-- Here the database calls it every minute (pg_cron + pg_net, both part of Supabase). The address and the secret live in a private table, set
-- once by whoever deploys (never in this file): private.app_secrets keys 'cron_url' and 'cron_secret'. With either missing, the tick does nothing.
-- A database without those extensions (a local test database) simply skips the scheduling.
-- Idempotent. Rollback: select cron.unschedule('padharosaa-tick'); drop the function and the table.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then create extension if not exists pg_net; end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then create extension if not exists pg_cron; end if;
end $$;

create table if not exists private.app_secrets (
  key        text primary key check (char_length(key) between 1 and 60),
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table private.app_secrets enable row level security;
revoke all on private.app_secrets from public, anon, authenticated;

create or replace function private.cron_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.app_secrets where key = 'cron_url';
  select value into v_secret from private.app_secrets where key = 'cron_secret';
  if v_url is null or v_secret is null or v_url !~ '^https://' then return; end if;
  perform net.http_get(url := v_url, headers := jsonb_build_object('authorization', 'Bearer ' || v_secret), timeout_milliseconds := 8000);
end $$;
revoke all on function private.cron_tick() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('padharosaa-tick', '* * * * *', 'select private.cron_tick()');
  end if;
end $$;

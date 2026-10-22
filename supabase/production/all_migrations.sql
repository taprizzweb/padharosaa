-- GoToMenu: ALL database migrations in order (0001 to 0025), for a NEW, EMPTY production Supabase project.
-- Run once in SQL Editor > New query > paste > Run. Do not run on a project that already has data.
-- Generated from supabase/migrations; do not edit by hand.


-- ================= 0001_baseline_privileges.sql =================
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

-- ================= 0002_core_tables.sql =================
-- 0002_core_tables
-- All business tables. Money = integer paise. Every business table carries restaurant_id.
-- Cross-tenant references are impossible: child rows reference parents with COMPOSITE foreign
-- keys (id, restaurant_id), so a row can never point at another restaurant's row.
-- Idempotent (IF NOT EXISTS). Rollback: DROP TABLE ... CASCADE in reverse order (data loss).

create table if not exists public.restaurants (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  status         text not null default 'active',
  plan           text not null default 'pilot',
  paid_until     timestamptz,
  review_url     text,
  accent         text not null default 'saffron',
  order_counter  bigint not null default 0,
  amber_minutes  int not null default 5,
  red_minutes    int not null default 10,
  created_at     timestamptz not null default now(),
  constraint restaurants_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and slug !~ '--'),
  constraint restaurants_slug_reserved check (slug <> all (array[
    'admin','staff','dash','dashboard','api','login','logout','auth','_next','static','assets','health',
    'privacy','terms','support','dev','public','app','www','mail','help','about','contact','signup',
    'register','settings','account','status','favicon','robots','sitemap','manifest','sw','offline',
    'images','img','menu','demo','test','null','undefined'])),
  constraint restaurants_name_len check (char_length(name) between 1 and 80),
  constraint restaurants_status check (status in ('active','suspended')),
  constraint restaurants_plan_len check (char_length(plan) between 1 and 30),
  constraint restaurants_review_url check (review_url is null or (review_url ~ '^https://[^[:space:]]+$' and char_length(review_url) <= 500)),
  constraint restaurants_accent check (accent in ('saffron','tomato','emerald','teal','indigo','plum','rose','slate')),
  constraint restaurants_counter check (order_counter >= 0),
  constraint restaurants_thresholds check (amber_minutes between 1 and 120 and red_minutes between 1 and 240 and red_minutes > amber_minutes)
);

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.staff (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role          text not null,
  display_name  text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint staff_role check (role in ('owner','manager','waiter','kitchen')),
  constraint staff_name_len check (char_length(display_name) between 1 and 60)
);
create index if not exists staff_restaurant_idx on public.staff (restaurant_id);

create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name_en       text not null,
  name_hi       text,
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint categories_name_en_len check (char_length(name_en) between 1 and 60),
  constraint categories_name_hi_len check (name_hi is null or char_length(name_hi) between 1 and 60),
  constraint categories_id_restaurant_uq unique (id, restaurant_id)
);
create index if not exists categories_restaurant_idx on public.categories (restaurant_id, sort_order);

create table if not exists public.items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  category_id    uuid not null,
  name_en        text not null,
  name_hi        text,
  description_en text,
  description_hi text,
  price_paise    int not null,
  diet           text not null default 'veg',
  spice          smallint not null default 0,
  image_path     text,
  is_available   boolean not null default true,
  is_bestseller  boolean not null default false,
  is_chef_pick   boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  constraint items_category_fk foreign key (category_id, restaurant_id)
    references public.categories (id, restaurant_id) ,
  constraint items_id_restaurant_uq unique (id, restaurant_id),
  constraint items_name_en_len check (char_length(name_en) between 1 and 80),
  constraint items_name_hi_len check (name_hi is null or char_length(name_hi) between 1 and 80),
  constraint items_desc_en_len check (description_en is null or char_length(description_en) <= 300),
  constraint items_desc_hi_len check (description_hi is null or char_length(description_hi) <= 300),
  constraint items_price check (price_paise between 0 and 10000000),
  constraint items_diet check (diet in ('veg','nonveg','egg','jain')),
  constraint items_spice check (spice between 0 and 3),
  -- uploads must live in the restaurant's own storage folder, with no path tricks
  constraint items_image_path check (image_path is null or (
    image_path like restaurant_id::text || '/%' and image_path !~ '\.\.' and char_length(image_path) <= 200))
);
create index if not exists items_category_idx on public.items (category_id);
create index if not exists items_restaurant_idx on public.items (restaurant_id, category_id, sort_order);

create table if not exists public.dining_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label         text not null,
  -- 2 x 122 random bits (two UUIDv4, hyphens removed) = comfortably above 128 bits of entropy
  qr_token      text not null unique
                default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint dining_tables_label_len check (char_length(label) between 1 and 20),
  constraint dining_tables_token_format check (qr_token ~ '^[0-9a-f]{64}$'),
  constraint dining_tables_label_uq unique (restaurant_id, label),
  constraint dining_tables_id_restaurant_uq unique (id, restaurant_id)
);

create table if not exists public.table_sessions (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  table_id          uuid not null,
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         uuid references auth.users (id) on delete set null,
  close_reason      text,
  pay_mode          text,
  bill_requested_at timestamptz,
  final_total_paise int,
  constraint sessions_table_fk foreign key (table_id, restaurant_id)
    references public.dining_tables (id, restaurant_id) ,
  constraint sessions_id_restaurant_uq unique (id, restaurant_id),
  constraint sessions_pay_mode check (pay_mode is null or pay_mode in ('cash','upi','card')),
  constraint sessions_close_reason check (close_reason is null or close_reason in ('paid','forced')),
  constraint sessions_closed_order check (closed_at is null or closed_at >= opened_at),
  constraint sessions_closed_fields check ((closed_at is null) = (close_reason is null)),
  constraint sessions_total check (final_total_paise is null or final_total_paise >= 0)
);
-- exactly one open session per table
create unique index if not exists sessions_one_open_per_table on public.table_sessions (table_id) where closed_at is null;
create index if not exists sessions_restaurant_open_idx on public.table_sessions (restaurant_id, closed_at);
create index if not exists sessions_table_idx on public.table_sessions (table_id);

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  session_id      uuid not null,
  table_id        uuid not null,
  order_no        bigint not null,
  status          text not null default 'placed',
  note            text,
  total_paise     int not null,
  idempotency_key text not null,
  created_at      timestamptz not null default now(),
  preparing_at    timestamptz,
  ready_at        timestamptz,
  served_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  status_by       uuid references auth.users (id) on delete set null,
  constraint orders_session_fk foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete cascade,
  constraint orders_table_fk foreign key (table_id, restaurant_id)
    references public.dining_tables (id, restaurant_id) ,
  constraint orders_id_restaurant_uq unique (id, restaurant_id),
  constraint orders_no_uq unique (restaurant_id, order_no),
  constraint orders_idem_uq unique (session_id, idempotency_key),
  constraint orders_status check (status in ('placed','preparing','ready','served','cancelled')),
  constraint orders_note_len check (note is null or char_length(note) <= 200),
  constraint orders_total check (total_paise between 0 and 100000000),
  constraint orders_idem_len check (char_length(idempotency_key) between 8 and 64),
  constraint orders_cancel_reason check (status <> 'cancelled' or (cancel_reason is not null and char_length(cancel_reason) between 1 and 200))
);
create index if not exists orders_board_idx on public.orders (restaurant_id, status, created_at);
create index if not exists orders_session_idx on public.orders (session_id, created_at);
create index if not exists orders_table_idx on public.orders (table_id, created_at);

create table if not exists public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null,
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  item_id            uuid,
  name_en_snapshot   text not null,
  name_hi_snapshot   text,
  unit_price_paise   int not null,
  qty                int not null,
  note               text,
  constraint order_items_order_fk foreign key (order_id, restaurant_id)
    references public.orders (id, restaurant_id) on delete cascade,
  constraint order_items_item_fk foreign key (item_id, restaurant_id)
    references public.items (id, restaurant_id) on delete set null (item_id),
  constraint order_items_qty check (qty between 1 and 20),
  constraint order_items_price check (unit_price_paise between 0 and 10000000),
  constraint order_items_note_len check (note is null or char_length(note) <= 100),
  constraint order_items_name_len check (char_length(name_en_snapshot) between 1 and 80)
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_item_idx on public.order_items (item_id);
create index if not exists order_items_restaurant_idx on public.order_items (restaurant_id);

create table if not exists public.service_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id      uuid not null,
  session_id    uuid not null,
  type          text not null,
  reason        text,
  pay_mode      text,
  status        text not null default 'open',
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users (id) on delete set null,
  constraint requests_table_fk foreign key (table_id, restaurant_id)
    references public.dining_tables (id, restaurant_id) ,
  constraint requests_session_fk foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete cascade,
  constraint requests_type check (type in ('waiter','bill')),
  constraint requests_reason check (reason is null or reason in ('water','cutlery','cleaning','help','other')),
  constraint requests_pay_mode check (pay_mode is null or pay_mode in ('cash','upi','card')),
  constraint requests_status check (status in ('open','done')),
  constraint requests_shape check (
    (type = 'bill'   and pay_mode is not null and reason is null) or
    (type = 'waiter' and pay_mode is null and reason is not null))
);
-- at most one open request per session per type: a second tap is idempotent
create unique index if not exists requests_one_open_per_type on public.service_requests (session_id, type) where status = 'open';
create index if not exists requests_board_idx on public.service_requests (restaurant_id, status, created_at);
create index if not exists requests_table_idx on public.service_requests (table_id);
create index if not exists requests_session_idx on public.service_requests (session_id);

create table if not exists public.review_clicks (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  session_id    uuid not null,
  created_at    timestamptz not null default now(),
  constraint review_clicks_session_fk foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete cascade
);
create index if not exists review_clicks_restaurant_idx on public.review_clicks (restaurant_id, created_at);
create index if not exists review_clicks_session_idx on public.review_clicks (session_id);

-- Fixed-window counters for rate limiting. `key` is already a salted hash built by the app.
create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0,
  constraint rate_limits_key_len check (char_length(key) <= 200)
);
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- ================= 0003_rls_and_grants.sql =================
-- 0003_rls_and_grants
-- Row Level Security on EVERY table + the minimum grants staff need.
-- Staff can READ their own restaurant's rows. Menu/table/settings edits are direct writes guarded by
-- RLS (owner/manager only, restaurant must be active). Orders, sessions and requests have NO write
-- grants at all: they change only through the SECURITY DEFINER functions in 0005/0006.
-- Idempotent (drop policy if exists). Rollback: drop policies, `alter table .. disable row level security`.

-- ---------- helpers used by policies (SECURITY DEFINER so they can read `staff` without recursion) ----------
create or replace function private.my_restaurant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.restaurant_id from public.staff s where s.user_id = auth.uid() and s.active
$$;

create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s where s.user_id = auth.uid() and s.active
$$;

create or replace function private.my_restaurant_is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active), false)
$$;

-- owner or manager of an ACTIVE restaurant
create or replace function private.can_manage() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.role in ('owner','manager') and r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active), false)
$$;

create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.role = 'owner' and r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active), false)
$$;

revoke all on function private.my_restaurant_id(), private.my_role(), private.my_restaurant_is_active(),
  private.can_manage(), private.is_owner() from public, anon;
grant execute on function private.my_restaurant_id(), private.my_role(), private.my_restaurant_is_active(),
  private.can_manage(), private.is_owner() to authenticated;

-- ---------- enable RLS everywhere ----------
alter table public.restaurants      enable row level security;
alter table public.platform_admins  enable row level security;
alter table public.staff            enable row level security;
alter table public.categories       enable row level security;
alter table public.items            enable row level security;
alter table public.dining_tables    enable row level security;
alter table public.table_sessions   enable row level security;
alter table public.orders           enable row level security;
alter table public.order_items      enable row level security;
alter table public.service_requests enable row level security;
alter table public.review_clicks    enable row level security;
alter table public.rate_limits      enable row level security;
-- platform_admins and rate_limits: RLS on, no policies, no grants => unreachable for anon/authenticated.

-- ---------- read policies (every role, own restaurant only) ----------
drop policy if exists restaurants_select on public.restaurants;
create policy restaurants_select on public.restaurants for select to authenticated
  using (id = (select private.my_restaurant_id()));

drop policy if exists staff_select on public.staff;
create policy staff_select on public.staff for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
         and ((select private.my_role()) in ('owner','manager') or user_id = (select auth.uid())));

drop policy if exists categories_select on public.categories;
create policy categories_select on public.categories for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

drop policy if exists dining_tables_select on public.dining_tables;
create policy dining_tables_select on public.dining_tables for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

drop policy if exists table_sessions_select on public.table_sessions;
create policy table_sessions_select on public.table_sessions for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

drop policy if exists orders_select on public.orders;
create policy orders_select on public.orders for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

drop policy if exists order_items_select on public.order_items;
create policy order_items_select on public.order_items for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

drop policy if exists service_requests_select on public.service_requests;
create policy service_requests_select on public.service_requests for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

-- reports are for owner/manager
drop policy if exists review_clicks_select on public.review_clicks;
create policy review_clicks_select on public.review_clicks for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.my_role()) in ('owner','manager'));

-- ---------- write policies: owner/manager of an active restaurant ----------
drop policy if exists restaurants_update on public.restaurants;
create policy restaurants_update on public.restaurants for update to authenticated
  using (id = (select private.my_restaurant_id()) and (select private.is_owner()))
  with check (id = (select private.my_restaurant_id()) and (select private.is_owner()));

drop policy if exists categories_insert on public.categories;
create policy categories_insert on public.categories for insert to authenticated
  with check (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()));
drop policy if exists categories_update on public.categories;
create policy categories_update on public.categories for update to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()))
  with check (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()));
drop policy if exists categories_delete on public.categories;
create policy categories_delete on public.categories for delete to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()));

drop policy if exists items_insert on public.items;
create policy items_insert on public.items for insert to authenticated
  with check (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()));
drop policy if exists items_update on public.items;
create policy items_update on public.items for update to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()))
  with check (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()));
drop policy if exists items_delete on public.items;
create policy items_delete on public.items for delete to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()));

drop policy if exists dining_tables_insert on public.dining_tables;
create policy dining_tables_insert on public.dining_tables for insert to authenticated
  with check (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()));
drop policy if exists dining_tables_update on public.dining_tables;
create policy dining_tables_update on public.dining_tables for update to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()))
  with check (restaurant_id = (select private.my_restaurant_id()) and (select private.can_manage()));

-- ---------- grants (column-level where it matters) ----------
grant select on public.restaurants to authenticated;
grant update (name, review_url, accent, amber_minutes, red_minutes) on public.restaurants to authenticated;

grant select on public.staff to authenticated;                       -- writes: owner RPCs only (Phase 4)

grant select on public.categories to authenticated;
grant insert (restaurant_id, name_en, name_hi, sort_order, active) on public.categories to authenticated;
grant update (name_en, name_hi, sort_order, active) on public.categories to authenticated;
grant delete on public.categories to authenticated;

grant select on public.items to authenticated;
grant insert (restaurant_id, category_id, name_en, name_hi, description_en, description_hi, price_paise, diet,
              spice, image_path, is_available, is_bestseller, is_chef_pick, sort_order) on public.items to authenticated;
-- is_available is deliberately NOT updatable directly: it changes via staff_set_item_availability (audited)
grant update (category_id, name_en, name_hi, description_en, description_hi, price_paise, diet, spice,
              image_path, is_bestseller, is_chef_pick, sort_order) on public.items to authenticated;
grant delete on public.items to authenticated;

-- qr_token is NOT selectable/insertable/updatable: it is only reachable via owner/manager RPCs.
grant select (id, restaurant_id, label, active, created_at) on public.dining_tables to authenticated;
grant insert (restaurant_id, label, active) on public.dining_tables to authenticated;
grant update (label, active) on public.dining_tables to authenticated;

-- read-only for staff (rows are created/changed only by SECURITY DEFINER functions)
grant select on public.table_sessions, public.orders, public.order_items, public.service_requests,
  public.review_clicks to authenticated;

-- ================= 0004_audit_log.sql =================
-- 0004_audit_log
-- Append-only audit trail. UPDATE/DELETE/TRUNCATE are blocked by privileges AND by triggers.
-- Row-level triggers on menu/table/staff/settings tables record who changed what.
-- Idempotent. Rollback: drop triggers and table audit_log.

create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  restaurant_id uuid references public.restaurants (id) on delete cascade,
  actor_user_id uuid,
  actor_role    text,
  action        text not null,
  entity        text not null,
  entity_id     text,
  details       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  constraint audit_action_len check (char_length(action) between 1 and 60),
  constraint audit_entity_len check (char_length(entity) between 1 and 60)
);
create index if not exists audit_restaurant_idx on public.audit_log (restaurant_id, created_at desc);
create index if not exists audit_actor_idx on public.audit_log (actor_user_id);

alter table public.audit_log enable row level security;
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.my_role()) in ('owner','manager'));
grant select on public.audit_log to authenticated;

-- Block tampering. The only exception is the admin purge function, which sets a transaction-local flag.
create or replace function private.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('gotomenu.audit_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception using errcode = 'GM017', message = 'audit_log_is_append_only';
end $$;

drop trigger if exists audit_no_update on public.audit_log;
create trigger audit_no_update before update on public.audit_log
  for each row execute function private.audit_immutable();
drop trigger if exists audit_no_delete on public.audit_log;
create trigger audit_no_delete before delete on public.audit_log
  for each row execute function private.audit_immutable();
drop trigger if exists audit_no_truncate on public.audit_log;
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function private.audit_immutable();

-- Single write path used by triggers and SQL functions.
create or replace function private.write_audit(p_restaurant uuid, p_action text, p_entity text,
                                               p_entity_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, auth.uid(), private.my_role(), p_action, p_entity, p_entity_id,
          coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function private.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- Generic row trigger. Secrets (qr_token) are never written to the log; noisy counters are ignored.
create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_skip text[] := array['qr_token','order_counter'];
  v_row jsonb; v_old jsonb; v_diff jsonb; v_rid uuid; v_id text;
begin
  -- During an admin purge the whole restaurant is being deleted; the admin function logs that itself.
  if coalesce(current_setting('gotomenu.audit_purge', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then v_row := to_jsonb(old) - v_skip; else v_row := to_jsonb(new) - v_skip; end if;
  v_diff := v_row;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - v_skip;
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into v_diff
      from jsonb_each(v_row) n join jsonb_each(v_old) o on o.key = n.key
      where n.value is distinct from o.value;
    if v_diff = '{}'::jsonb then return null; end if;
  end if;
  v_rid := coalesce((v_row->>'restaurant_id')::uuid, case when tg_table_name = 'restaurants' then (v_row->>'id')::uuid end);
  v_id  := coalesce(v_row->>'id', v_row->>'user_id');
  perform private.write_audit(v_rid, lower(tg_op), tg_table_name, v_id, v_diff);
  return null;
end $$;
revoke all on function private.audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['staff','categories','items','dining_tables'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function private.audit_row()', t);
  end loop;
end $$;

-- restaurants: every order bumps order_counter; only log real settings changes
drop trigger if exists audit_restaurants on public.restaurants;
drop trigger if exists audit_restaurants_ins_del on public.restaurants;
drop trigger if exists audit_restaurants_upd on public.restaurants;
create trigger audit_restaurants_ins_del after insert or delete on public.restaurants
  for each row execute function private.audit_row();
create trigger audit_restaurants_upd after update on public.restaurants
  for each row when (
    (old.slug, old.name, old.status, old.plan, old.paid_until, old.review_url, old.accent, old.amber_minutes, old.red_minutes)
    is distinct from
    (new.slug, new.name, new.status, new.plan, new.paid_until, new.review_url, new.accent, new.amber_minutes, new.red_minutes))
  execute function private.audit_row();

-- ================= 0005_guest_functions.sql =================
-- 0005_guest_functions
-- Everything a guest can do. Guests never touch tables: the Next.js server calls these functions
-- with the service-role key. Each is SECURITY DEFINER with search_path = '' and executable by
-- service_role ONLY.
--
-- Error codes (SQLSTATE -> message) are mapped to friendly translated text by the app:
--   GM001 restaurant_suspended   GM002 invalid_table_token   GM003 item_unavailable
--   GM004 item_not_found         GM005 duplicate_item        GM006 limit_exceeded
--   GM007 rate_limited           GM008 too_many_pending      GM009 session_closed
--   GM010 invalid_transition     GM011 forbidden             GM012 not_found
--   GM013 unserved_orders        GM014 reason_required       GM015 invalid_input
--   GM016 no_orders              GM017 audit_log_is_append_only
-- Idempotent (create or replace). Rollback: drop the functions.

-- ---------- atomic fixed-window counter ----------
create or replace function private.rl_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when rl.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else rl.count + 1 end,
    window_start = case when rl.window_start <= now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end $$;
revoke all on function private.rl_hit(text, int, int) from public, anon, authenticated;

create or replace function public.guest_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language sql security definer set search_path = '' as $$
  select private.rl_hit(p_key, p_limit, p_window_seconds)
$$;

create or replace function public.guest_purge_rate_limits() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.guest_health() returns timestamptz
language sql stable security definer set search_path = '' as $$ select now() $$;

-- ---------- menu ----------
create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick)
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;

-- ---------- place order (atomic) ----------
create or replace function public.guest_place_order(
  p_slug text, p_token text, p_items jsonb, p_note text, p_idem text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_max_lines   constant int := 25;
  c_max_qty     constant int := 10;
  c_max_total   constant bigint := 1500000;   -- Rs 15,000 in paise
  c_max_pending constant int := 3;            -- un-accepted orders per table session
  c_max_per_10m constant int := 8;            -- orders per table per 10 minutes
  -- Successful orders per IP per 10 min (generous: cafes share one wifi IP). NOTE: a failed call rolls back
  -- its own counter, so throttling of FAILED attempts (token guessing) is done by the route handler through
  -- guest_rate_limit(), which runs and commits in its own transaction before this function is called.
  c_ip_limit    constant int := 60;
  t public.dining_tables;
  r public.restaurants;
  s public.table_sessions;
  o public.orders;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_total bigint;
  v_lines int;
  v_found int;
  v_order_no bigint;
begin
  if p_ip_hash is not null and not private.rl_hit('ip:' || p_ip_hash, c_ip_limit, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  if p_slug is null or p_token is null or p_idem is null or char_length(p_idem) not between 8 and 64
     or (v_note is not null and char_length(v_note) > 200)
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  v_lines := jsonb_array_length(p_items);
  if v_lines > c_max_lines then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  begin
    perform 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text);
  exception when others then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)
             where x.item_id is null or x.qty is null or x.qty < 1 or char_length(coalesce(x.note, '')) > 100) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text) where x.qty > c_max_qty) then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  if (select count(distinct x.item_id) from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)) <> v_lines then
    raise exception using errcode = 'GM005', message = 'duplicate_item';
  end if;

  -- the token must belong to the restaurant named in the URL
  select t2.* into t
    from public.dining_tables t2 join public.restaurants r2 on r2.id = t2.restaurant_id
   where t2.qr_token = p_token and r2.slug = p_slug and t2.active;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;

  -- Serialise all ordering for this restaurant (also gives gap-free unique order numbers).
  -- NO KEY UPDATE (not FOR UPDATE): it still excludes other orders, but does not conflict with the
  -- FOR KEY SHARE lock that foreign-key checks (e.g. audit rows written by close-table) take on this row.
  -- Plain FOR UPDATE caused a deadlock between "close table" and "place order" (found by the race test).
  select * into r from public.restaurants where id = t.restaurant_id for no key update;
  if r.status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;

  -- idempotent replay: same key from the same table within the last hour returns the same order
  select * into o from public.orders
   where table_id = t.id and idempotency_key = p_idem and created_at > now() - interval '1 hour'
   limit 1;
  if found then
    return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'total_paise', o.total_paise,
      'session_id', o.session_id, 'table_label', t.label, 'status', o.status, 'replayed', true);
  end if;

  select * into s from public.table_sessions where table_id = t.id and closed_at is null for update;
  if not found then
    insert into public.table_sessions (restaurant_id, table_id) values (r.id, t.id) returning * into s;
  end if;

  if (select count(*) from public.orders where session_id = s.id and status = 'placed') >= c_max_pending then
    raise exception using errcode = 'GM008', message = 'too_many_pending';
  end if;
  if (select count(*) from public.orders where table_id = t.id and created_at > now() - interval '10 minutes') >= c_max_per_10m then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  -- lock the item rows (stable order) so prices cannot change before we commit
  perform 1 from public.items i
   where i.restaurant_id = r.id
     and i.id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text))
   order by i.id for share;

  select count(*), sum(i.price_paise::bigint * x.qty) into v_found, v_total
    from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)
    join public.items i on i.id = x.item_id and i.restaurant_id = r.id;
  if v_found <> v_lines then
    raise exception using errcode = 'GM004', message = 'item_not_found';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)
             join public.items i on i.id = x.item_id and i.restaurant_id = r.id
             join public.categories c on c.id = i.category_id and c.restaurant_id = r.id
             where not i.is_available or not c.active) then
    raise exception using errcode = 'GM003', message = 'item_unavailable';
  end if;
  if v_total > c_max_total then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;

  update public.restaurants set order_counter = order_counter + 1 where id = r.id returning order_counter into v_order_no;

  insert into public.orders (restaurant_id, session_id, table_id, order_no, note, total_paise, idempotency_key)
  values (r.id, s.id, t.id, v_order_no, v_note, v_total, p_idem)
  returning * into o;

  insert into public.order_items (order_id, restaurant_id, item_id, name_en_snapshot, name_hi_snapshot,
                                  unit_price_paise, qty, note)
  select o.id, r.id, i.id, i.name_en, i.name_hi, i.price_paise, x.qty, nullif(btrim(coalesce(x.note, '')), '')
    from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)
    join public.items i on i.id = x.item_id and i.restaurant_id = r.id;

  return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'total_paise', o.total_paise,
    'session_id', s.id, 'table_label', t.label, 'status', o.status, 'replayed', false);
end $$;

-- ---------- live status for the guest's own table session ----------
create or replace function public.guest_get_status(p_session_id uuid, p_thankyou_minutes int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.table_sessions;
  r public.restaurants;
  v_label text;
begin
  select * into s from public.table_sessions where id = p_session_id;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if s.closed_at is not null and s.closed_at < now() - make_interval(mins => p_thankyou_minutes) then
    return jsonb_build_object('state', 'expired');
  end if;
  select * into r from public.restaurants where id = s.restaurant_id;
  select label into v_label from public.dining_tables where id = s.table_id;
  return jsonb_build_object(
    'state', case when s.closed_at is null then 'open' else 'closed' end,
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent, 'status', r.status),
    'table_label', v_label,
    'pay_mode', s.pay_mode,
    'bill_requested', s.bill_requested_at is not null,
    'total_paise', coalesce(s.final_total_paise, (
        select coalesce(sum(o.total_paise), 0) from public.orders o where o.session_id = s.id and o.status <> 'cancelled')),
    'review_available', s.closed_at is not null and r.review_url is not null,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_no', o.order_no, 'status', o.status, 'note', o.note, 'total_paise', o.total_paise,
        'created_at', o.created_at, 'cancel_reason', o.cancel_reason,
        'items', coalesce((select jsonb_agg(jsonb_build_object('name_en', oi.name_en_snapshot,
                  'name_hi', oi.name_hi_snapshot, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise,
                  'note', oi.note) order by oi.name_en_snapshot)
                  from public.order_items oi where oi.order_id = o.id), '[]'::jsonb))
        order by o.created_at)
      from public.orders o where o.session_id = s.id), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode,
                                          'status', q.status, 'created_at', q.created_at) order by q.created_at)
      from public.service_requests q where q.session_id = s.id and q.status = 'open'), '[]'::jsonb));
end $$;

-- ---------- call waiter / ask for bill (a repeat tap is idempotent) ----------
create or replace function public.guest_create_request(
  p_session_id uuid, p_type text, p_reason text default null, p_pay_mode text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.table_sessions;
  r public.restaurants;
  q public.service_requests;
begin
  if p_type not in ('waiter','bill')
     or (p_type = 'waiter' and (p_reason is null or p_reason not in ('water','cutlery','cleaning','help','other')))
     or (p_type = 'bill' and (p_pay_mode is null or p_pay_mode not in ('cash','upi','card'))) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  select * into s from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if s.closed_at is not null then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;
  select * into r from public.restaurants where id = s.restaurant_id;
  if r.status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  if not private.rl_hit('req:' || s.id::text, 12, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  if p_type = 'waiter' then
    insert into public.service_requests (restaurant_id, table_id, session_id, type, reason)
    values (s.restaurant_id, s.table_id, s.id, 'waiter', p_reason)
    on conflict (session_id, type) where status = 'open' do nothing
    returning * into q;
    if q.id is null then
      select * into q from public.service_requests where session_id = s.id and type = 'waiter' and status = 'open';
    end if;
  else
    if not exists (select 1 from public.orders where session_id = s.id and status <> 'cancelled') then
      raise exception using errcode = 'GM016', message = 'no_orders';
    end if;
    insert into public.service_requests (restaurant_id, table_id, session_id, type, pay_mode)
    values (s.restaurant_id, s.table_id, s.id, 'bill', p_pay_mode)
    on conflict (session_id, type) where status = 'open' do update set pay_mode = excluded.pay_mode
    returning * into q;
    update public.table_sessions
       set pay_mode = p_pay_mode, bill_requested_at = coalesce(bill_requested_at, now())
     where id = s.id;
  end if;
  return jsonb_build_object('type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode, 'status', q.status);
end $$;

-- ---------- review button: record the tap, return the link ----------
create or replace function public.guest_record_review_click(p_session_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.table_sessions;
  v_url text;
begin
  select * into s from public.table_sessions where id = p_session_id;
  if not found or s.closed_at is null or s.closed_at < now() - interval '24 hours' then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  select review_url into v_url from public.restaurants where id = s.restaurant_id;
  if v_url is null then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if private.rl_hit('rv:' || s.id::text, 5, 3600) then
    insert into public.review_clicks (restaurant_id, session_id) values (s.restaurant_id, s.id);
  end if;
  return v_url;
end $$;

-- ---------- grants: service_role only ----------
revoke all on function public.guest_rate_limit(text, int, int), public.guest_purge_rate_limits(),
  public.guest_health(), public.guest_get_menu(text, text),
  public.guest_place_order(text, text, jsonb, text, text, text),
  public.guest_get_status(uuid, int),
  public.guest_create_request(uuid, text, text, text),
  public.guest_record_review_click(uuid) from public, anon, authenticated;
grant execute on function public.guest_rate_limit(text, int, int), public.guest_purge_rate_limits(),
  public.guest_health(), public.guest_get_menu(text, text),
  public.guest_place_order(text, text, jsonb, text, text, text),
  public.guest_get_status(uuid, int),
  public.guest_create_request(uuid, text, text, text),
  public.guest_record_review_click(uuid) to service_role;

-- ================= 0006_staff_functions.sql =================
-- 0006_staff_functions
-- State changes by staff. Each function checks the caller's role and that the restaurant is active.
-- Executable by `authenticated` only. Idempotent (create or replace). Rollback: drop the functions.

create or replace function private.require_staff(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text; v_status text;
begin
  select s.restaurant_id, s.role, r.status into v_rid, v_role, v_status
    from public.staff s join public.restaurants r on r.id = s.restaurant_id
   where s.user_id = auth.uid() and s.active;
  if v_rid is null or not (v_role = any (p_roles)) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  if v_status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  return v_rid;
end $$;
revoke all on function private.require_staff(text[]) from public, anon, authenticated;

-- ---------- order status: placed -> preparing -> ready -> served ; cancel from placed/preparing ----------
create or replace function public.staff_set_order_status(p_order_id uuid, p_new text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
  o public.orders;
  v_closed timestamptz;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_rid := private.require_staff(array['owner','manager','waiter','kitchen']);
  v_role := private.my_role();

  select * into o from public.orders where id = p_order_id and restaurant_id = v_rid for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  select closed_at into v_closed from public.table_sessions where id = o.session_id;
  if v_closed is not null then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;

  if p_new = 'cancelled' then
    if v_role not in ('owner','manager','waiter') then
      raise exception using errcode = 'GM011', message = 'forbidden';
    end if;
    if o.status not in ('placed','preparing') then
      raise exception using errcode = 'GM010', message = 'invalid_transition';
    end if;
    if v_reason is null or char_length(v_reason) > 200 then
      raise exception using errcode = 'GM014', message = 'reason_required';
    end if;
    update public.orders set status = 'cancelled', cancelled_at = now(), cancel_reason = v_reason, status_by = auth.uid()
     where id = o.id returning * into o;
    perform private.write_audit(v_rid, 'order_cancelled', 'orders', o.id::text,
      jsonb_build_object('order_no', o.order_no, 'reason', v_reason, 'total_paise', o.total_paise));
  elsif (o.status, p_new) in (('placed','preparing'), ('preparing','ready'), ('ready','served')) then
    update public.orders set
      status = p_new, status_by = auth.uid(),
      preparing_at = case when p_new = 'preparing' then now() else preparing_at end,
      ready_at     = case when p_new = 'ready'     then now() else ready_at end,
      served_at    = case when p_new = 'served'    then now() else served_at end
     where id = o.id returning * into o;
  else
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'status', o.status);
end $$;

-- ---------- waiter call / bill request done ----------
create or replace function public.staff_resolve_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; q public.service_requests;
begin
  v_rid := private.require_staff(array['owner','manager','waiter']);
  update public.service_requests set status = 'done', resolved_at = now(), resolved_by = auth.uid()
   where id = p_request_id and restaurant_id = v_rid and status = 'open'
   returning * into q;
  if not found then
    -- already done (double tap) is fine; a missing/foreign id is not
    select * into q from public.service_requests where id = p_request_id and restaurant_id = v_rid;
    if not found then
      raise exception using errcode = 'GM012', message = 'not_found';
    end if;
  end if;
  return jsonb_build_object('request_id', q.id, 'status', q.status);
end $$;

-- ---------- mark table paid (closes the session) ----------
create or replace function public.staff_close_session(
  p_session_id uuid, p_force boolean default false, p_reason text default null, p_pay_mode text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
  s public.table_sessions;
  v_unserved int;
  v_total int;
  v_label text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  v_rid := private.require_staff(array['owner','manager','waiter']);
  v_role := private.my_role();
  if p_pay_mode is not null and p_pay_mode not in ('cash','upi','card') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  select * into s from public.table_sessions where id = p_session_id and restaurant_id = v_rid for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if s.closed_at is not null then
    return jsonb_build_object('session_id', s.id, 'already_closed', true, 'total_paise', s.final_total_paise);
  end if;

  select count(*) into v_unserved from public.orders
   where session_id = s.id and status in ('placed','preparing','ready');
  if p_force then
    if v_role not in ('owner','manager') then
      raise exception using errcode = 'GM011', message = 'forbidden';
    end if;
    if v_reason is null or char_length(v_reason) > 200 then
      raise exception using errcode = 'GM014', message = 'reason_required';
    end if;
  elsif v_unserved > 0 then
    raise exception using errcode = 'GM013', message = 'unserved_orders';
  end if;

  select coalesce(sum(total_paise), 0) into v_total from public.orders where session_id = s.id and status <> 'cancelled';
  update public.table_sessions
     set closed_at = now(), closed_by = auth.uid(), close_reason = case when p_force then 'forced' else 'paid' end,
         final_total_paise = v_total, pay_mode = coalesce(p_pay_mode, pay_mode)
   where id = s.id;
  update public.service_requests set status = 'done', resolved_at = now(), resolved_by = auth.uid()
   where session_id = s.id and status = 'open';

  select label into v_label from public.dining_tables where id = s.table_id;
  perform private.write_audit(v_rid, case when p_force then 'table_force_closed' else 'table_paid' end,
    'table_sessions', s.id::text,
    jsonb_build_object('table', v_label, 'total_paise', v_total, 'unserved_orders', v_unserved, 'reason', v_reason));
  return jsonb_build_object('session_id', s.id, 'already_closed', false, 'total_paise', v_total);
end $$;

-- ---------- sold-out toggle (every role) ----------
create or replace function public.staff_set_item_availability(p_item_ids uuid[], p_available boolean)
returns int language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; v_found int; v_changed int := 0; rec record;
begin
  v_rid := private.require_staff(array['owner','manager','waiter','kitchen']);
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 500 or p_available is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select count(*) into v_found from public.items where id = any (p_item_ids) and restaurant_id = v_rid;
  if v_found <> (select count(distinct x) from unnest(p_item_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  for rec in
    update public.items set is_available = p_available
     where id = any (p_item_ids) and restaurant_id = v_rid and is_available is distinct from p_available
     returning id, name_en
  loop
    v_changed := v_changed + 1;
    perform private.write_audit(v_rid, 'item_availability', 'items', rec.id::text,
      jsonb_build_object('name', rec.name_en, 'is_available', p_available));
  end loop;
  return v_changed;
end $$;

-- ---------- owner / manager: table QR tokens ----------
create or replace function public.mgr_get_table_tokens()
returns table (table_id uuid, label text, active boolean, qr_token text)
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid;
begin
  v_rid := private.require_staff(array['owner','manager']);
  return query select t.id, t.label, t.active, t.qr_token from public.dining_tables t
               where t.restaurant_id = v_rid order by t.created_at, t.label;
end $$;

create or replace function public.mgr_rotate_table_token(p_table_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; v_token text; v_label text;
begin
  v_rid := private.require_staff(array['owner','manager']);
  update public.dining_tables
     set qr_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
   where id = p_table_id and restaurant_id = v_rid
   returning qr_token, label into v_token, v_label;
  if v_token is null then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  perform private.write_audit(v_rid, 'qr_rotated', 'dining_tables', p_table_id::text, jsonb_build_object('table', v_label));
  return v_token;
end $$;

-- create tables numbered p_from..p_to (existing labels are skipped); returns how many were created
create or replace function public.mgr_create_tables(p_from int, p_to int) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; v_n int;
begin
  v_rid := private.require_staff(array['owner','manager']);
  if p_from is null or p_to is null or p_from < 1 or p_to < p_from or p_to - p_from >= 200 or p_to > 999 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.dining_tables where restaurant_id = v_rid) + (p_to - p_from + 1) > 400 then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  insert into public.dining_tables (restaurant_id, label)
  select v_rid, g::text from generate_series(p_from, p_to) g
  on conflict (restaurant_id, label) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- grants ----------
revoke all on function public.staff_set_order_status(uuid, text, text), public.staff_resolve_request(uuid),
  public.staff_close_session(uuid, boolean, text, text), public.staff_set_item_availability(uuid[], boolean),
  public.mgr_get_table_tokens(), public.mgr_rotate_table_token(uuid), public.mgr_create_tables(int, int)
  from public, anon, authenticated, service_role;
grant execute on function public.staff_set_order_status(uuid, text, text), public.staff_resolve_request(uuid),
  public.staff_close_session(uuid, boolean, text, text), public.staff_set_item_availability(uuid[], boolean),
  public.mgr_get_table_tokens(), public.mgr_rotate_table_token(uuid), public.mgr_create_tables(int, int)
  to authenticated;

-- ================= 0007_storage_and_realtime.sql =================
-- 0007_storage_and_realtime
-- Menu photos: public-read bucket, folder = restaurant_id. Only owner/manager of that restaurant
-- (active) can upload/replace/delete inside their own folder. Images only, max 2 MB.
-- Realtime: staff screens subscribe to orders / requests / sessions (RLS filters every event).
-- Idempotent. Rollback: delete bucket + policies, remove tables from the publication.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images', 'menu-images', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists menu_images_select on storage.objects;
create policy menu_images_select on storage.objects for select to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
         and (select private.my_role()) in ('owner','manager'));

drop policy if exists menu_images_insert on storage.objects;
create policy menu_images_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
              and (select private.can_manage()));

drop policy if exists menu_images_update on storage.objects;
create policy menu_images_update on storage.objects for update to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
         and (select private.can_manage()))
  with check (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
              and (select private.can_manage()));

drop policy if exists menu_images_delete on storage.objects;
create policy menu_images_delete on storage.objects for delete to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = (select private.my_restaurant_id())::text
         and (select private.can_manage()));

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders','service_requests','table_sessions'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                     and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ================= 0008_admin_functions.sql =================
-- 0008_admin_functions
-- Platform-admin operations. Executable by service_role only; the Next.js server calls them AFTER
-- verifying the caller is a platform admin with a 2FA (AAL2) session. Each function re-checks the
-- platform_admins row as defence in depth and writes an audit row.
-- Idempotent. Rollback: drop the functions.

create or replace function private.require_admin(p_admin uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_admin is null or not exists (select 1 from public.platform_admins where user_id = p_admin) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
end $$;
revoke all on function private.require_admin(uuid) from public, anon, authenticated;

create or replace function public.admin_create_restaurant(
  p_admin uuid, p_slug text, p_name text, p_owner_user_id uuid, p_owner_name text,
  p_plan text default 'pilot', p_paid_until timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_admin(p_admin);
  insert into public.restaurants (slug, name, plan, paid_until)
  values (p_slug, p_name, coalesce(p_plan, 'pilot'), p_paid_until) returning id into v_id;
  insert into public.staff (user_id, restaurant_id, role, display_name) values (p_owner_user_id, v_id, 'owner', p_owner_name);
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (v_id, p_admin, 'platform_admin', 'restaurant_created', 'restaurants', v_id::text, jsonb_build_object('slug', p_slug));
  return v_id;
end $$;

create or replace function public.admin_set_status(p_admin uuid, p_restaurant uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  update public.restaurants set status = p_status where id = p_restaurant;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'restaurant_status', 'restaurants', p_restaurant::text,
          jsonb_build_object('status', p_status));
end $$;

create or replace function public.admin_set_plan(p_admin uuid, p_restaurant uuid, p_plan text, p_paid_until timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  update public.restaurants set plan = p_plan, paid_until = p_paid_until where id = p_restaurant;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'restaurant_plan', 'restaurants', p_restaurant::text,
          jsonb_build_object('plan', p_plan, 'paid_until', p_paid_until));
end $$;

create or replace function public.admin_list_restaurants(p_admin uuid)
returns table (id uuid, slug text, name text, status text, plan text, paid_until timestamptz,
               created_at timestamptz, last_order_at timestamptz, order_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  return query
    select r.id, r.slug, r.name, r.status, r.plan, r.paid_until, r.created_at,
           (select max(o.created_at) from public.orders o where o.restaurant_id = r.id),
           r.order_counter
      from public.restaurants r order by r.created_at desc;
end $$;

create or replace function public.admin_get_audit(p_admin uuid, p_restaurant uuid, p_limit int default 200)
returns setof public.audit_log language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  return query select * from public.audit_log where restaurant_id = p_restaurant
               order by created_at desc, id desc limit least(greatest(p_limit, 1), 1000);
end $$;

create or replace function public.admin_export_restaurant(p_admin uuid, p_restaurant uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.require_admin(p_admin);
  select jsonb_build_object(
    'restaurant', (select to_jsonb(r) from public.restaurants r where r.id = p_restaurant),
    'staff', coalesce((select jsonb_agg(to_jsonb(s)) from public.staff s where s.restaurant_id = p_restaurant), '[]'),
    'categories', coalesce((select jsonb_agg(to_jsonb(c)) from public.categories c where c.restaurant_id = p_restaurant), '[]'),
    'items', coalesce((select jsonb_agg(to_jsonb(i)) from public.items i where i.restaurant_id = p_restaurant), '[]'),
    'tables', coalesce((select jsonb_agg(to_jsonb(t) - 'qr_token') from public.dining_tables t where t.restaurant_id = p_restaurant), '[]'),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s)) from public.table_sessions s where s.restaurant_id = p_restaurant), '[]'),
    'orders', coalesce((select jsonb_agg(to_jsonb(o)) from public.orders o where o.restaurant_id = p_restaurant), '[]'),
    'order_items', coalesce((select jsonb_agg(to_jsonb(oi)) from public.order_items oi where oi.restaurant_id = p_restaurant), '[]'),
    'requests', coalesce((select jsonb_agg(to_jsonb(q)) from public.service_requests q where q.restaurant_id = p_restaurant), '[]'),
    'review_clicks', coalesce((select jsonb_agg(to_jsonb(k)) from public.review_clicks k where k.restaurant_id = p_restaurant), '[]'),
    'audit_log', coalesce((select jsonb_agg(to_jsonb(a)) from public.audit_log a where a.restaurant_id = p_restaurant), '[]'))
  into v;
  if v->'restaurant' = 'null'::jsonb then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id)
  values (p_restaurant, p_admin, 'platform_admin', 'restaurant_exported', 'restaurants', p_restaurant::text);
  return v;
end $$;

-- Permanently deletes a restaurant and everything under it (DPDP erasure). Returns the staff auth user ids
-- so the server can delete those Auth accounts too. A platform-level audit row (no restaurant id) is kept.
create or replace function public.admin_delete_restaurant(p_admin uuid, p_restaurant uuid, p_confirm_slug text)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; v_users uuid[];
begin
  perform private.require_admin(p_admin);
  select * into r from public.restaurants where id = p_restaurant for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if p_confirm_slug is distinct from r.slug then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select coalesce(array_agg(user_id), '{}') into v_users from public.staff where restaurant_id = r.id;
  perform set_config('gotomenu.audit_purge', 'on', true);
  delete from public.restaurants where id = r.id;
  perform set_config('gotomenu.audit_purge', 'off', true);
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (null, p_admin, 'platform_admin', 'restaurant_deleted', 'restaurants', r.id::text,
          jsonb_build_object('slug', r.slug, 'name', r.name));
  return v_users;
end $$;

revoke all on function public.admin_create_restaurant(uuid, text, text, uuid, text, text, timestamptz),
  public.admin_set_status(uuid, uuid, text), public.admin_set_plan(uuid, uuid, text, timestamptz),
  public.admin_list_restaurants(uuid), public.admin_get_audit(uuid, uuid, int),
  public.admin_export_restaurant(uuid, uuid), public.admin_delete_restaurant(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_create_restaurant(uuid, text, text, uuid, text, text, timestamptz),
  public.admin_set_status(uuid, uuid, text), public.admin_set_plan(uuid, uuid, text, timestamptz),
  public.admin_list_restaurants(uuid), public.admin_get_audit(uuid, uuid, int),
  public.admin_export_restaurant(uuid, uuid), public.admin_delete_restaurant(uuid, uuid, text)
  to service_role;

-- ================= 0009_guest_request_by_token.sql =================
-- 0009_guest_request_by_token
-- A guest can call the waiter before ordering anything (water, cutlery...), and can ask for the bill from a
-- phone that has lost its cookie. Both are identified by the table's QR token, never by a client-supplied id.
-- Waiter calls find-or-create the table's open session (like place_order); bill requests need an open session
-- that already has an order. Delegates to guest_create_request for validation, rate limiting and idempotency.
-- Idempotent. Rollback: drop function.

create or replace function public.guest_request_by_token(
  p_slug text, p_token text, p_type text, p_reason text default null, p_pay_mode text default null,
  p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.dining_tables;
  r public.restaurants;
  s public.table_sessions;
  v_req jsonb;
begin
  if p_type not in ('waiter','bill') or p_slug is null or p_token is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_ip_hash is not null and not private.rl_hit('rq:' || p_ip_hash, 120, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  select t2.* into t
    from public.dining_tables t2 join public.restaurants r2 on r2.id = t2.restaurant_id
   where t2.qr_token = p_token and r2.slug = p_slug and t2.active;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;

  -- same lock order as guest_place_order (restaurant, then session)
  select * into r from public.restaurants where id = t.restaurant_id for no key update;
  if r.status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;

  select * into s from public.table_sessions where table_id = t.id and closed_at is null;
  if not found then
    if p_type = 'bill' then
      raise exception using errcode = 'GM016', message = 'no_orders';
    end if;
    insert into public.table_sessions (restaurant_id, table_id) values (r.id, t.id) returning * into s;
  end if;

  v_req := public.guest_create_request(s.id, p_type, p_reason, p_pay_mode);
  return jsonb_build_object('session_id', s.id, 'table_label', t.label, 'request', v_req);
end $$;

revoke all on function public.guest_request_by_token(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.guest_request_by_token(text, text, text, text, text, text) to service_role;

-- ================= 0010_rate_limit_cleanup.sql =================
-- 0010_rate_limit_cleanup
-- The privacy notice promises scrambled-IP counters are deleted within a day. Rather than depend on an external
-- scheduler, roughly 2% of rate-limit calls also delete counters older than a day (cheap: indexed on window_start).
-- guest_purge_rate_limits() stays available for an explicit run. Idempotent. Rollback: restore the 0005 definition.

create or replace function public.guest_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return private.rl_hit(p_key, p_limit, p_window_seconds);
end $$;

revoke all on function public.guest_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.guest_rate_limit(text, int, int) to service_role;

-- ================= 0011_staff_reads.sql =================
-- 0011_staff_reads
-- Read functions for the staff screen. SECURITY DEFINER but every query is filtered by the CALLER's own
-- restaurant (taken from their staff row), so one function call can never see another restaurant's data.
-- Reads keep working for a suspended restaurant (staff can still see why); only writes are blocked.
-- Executable by `authenticated` only. Idempotent. Rollback: drop the three functions.

create or replace function public.staff_me() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', s.user_id, 'role', s.role, 'display_name', s.display_name,
    'restaurant', jsonb_build_object('id', r.id, 'name', r.name, 'slug', r.slug, 'status', r.status, 'accent', r.accent,
                                     'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes))
  from public.staff s join public.restaurants r on r.id = s.restaurant_id
  where s.user_id = auth.uid() and s.active
$$;

create or replace function public.staff_get_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return jsonb_build_object(
    'server_time', now(),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status, 'table_label', t.label, 'session_id', o.session_id,
        'note', o.note, 'total_paise', o.total_paise, 'created_at', o.created_at, 'preparing_at', o.preparing_at,
        'ready_at', o.ready_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_en_snapshot, 'qty', oi.qty, 'note', oi.note)
                                            order by oi.name_en_snapshot)
                           from public.order_items oi where oi.order_id = o.id), '[]'::jsonb))
        order by o.created_at)
      from public.orders o
      join public.dining_tables t on t.id = o.table_id
      join public.table_sessions s on s.id = o.session_id
      where o.restaurant_id = v_rid and s.closed_at is null and o.status in ('placed', 'preparing', 'ready')), '[]'::jsonb),
    -- the kitchen does not handle waiter calls, bills or payment
    'requests', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode, 'table_label', t.label,
        'session_id', q.session_id, 'created_at', q.created_at) order by q.created_at)
      from public.service_requests q join public.dining_tables t on t.id = q.table_id
      where q.restaurant_id = v_rid and q.status = 'open'), '[]'::jsonb) end,
    'sessions', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'table_label', t.label, 'opened_at', s.opened_at, 'pay_mode', s.pay_mode,
        'bill_requested_at', s.bill_requested_at,
        'total_paise', coalesce((select sum(o.total_paise) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'), 0),
        'orders_count', (select count(*) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'),
        'unserved_count', (select count(*) from public.orders o where o.session_id = s.id and o.status in ('placed', 'preparing', 'ready')))
        order by s.opened_at)
      from public.table_sessions s join public.dining_tables t on t.id = s.table_id
      where s.restaurant_id = v_rid and s.closed_at is null), '[]'::jsonb) end);
end $$;

create or replace function public.staff_list_items() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid;
begin
  select s.restaurant_id into v_rid from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name_en, 'category', c.name_en, 'diet', i.diet,
                                        'price_paise', i.price_paise, 'is_available', i.is_available)
                     order by c.sort_order, c.name_en, i.sort_order, i.name_en)
    from public.items i join public.categories c on c.id = i.category_id
    where i.restaurant_id = v_rid), '[]'::jsonb);
end $$;

revoke all on function public.staff_me(), public.staff_get_board(), public.staff_list_items() from public, anon, authenticated, service_role;
grant execute on function public.staff_me(), public.staff_get_board(), public.staff_list_items() to authenticated;

-- ================= 0012_failure_only_throttle.sql =================
-- 0012_failure_only_throttle
-- A shared cafe wifi puts dozens of honest guests behind ONE IP address, so counting every request per IP would block
-- real customers. Abuse that matters (guessing QR tokens, guessing passwords) is made of FAILURES. These two functions let
-- the server (a) check a counter without touching it and (b) add one to it only after a failure. Each runs and commits in
-- its own transaction, so the penalty survives the failed call it follows.
-- Executable by service_role only. Idempotent. Rollback: drop both functions.

create or replace function public.guest_rate_check(p_key text, p_limit int, p_window_seconds int)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select rl.window_start <= now() - make_interval(secs => p_window_seconds) or rl.count < p_limit
    from public.rate_limits rl where rl.key = p_key), true)
$$;

create or replace function public.guest_rate_hit(p_key text, p_window_seconds int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  perform private.rl_hit(p_key, 2147483647, p_window_seconds);
end $$;

revoke all on function public.guest_rate_check(text, int, int), public.guest_rate_hit(text, int) from public, anon, authenticated;
grant execute on function public.guest_rate_check(text, int, int), public.guest_rate_hit(text, int) to service_role;

-- ================= 0013_dashboard_functions.sql =================
-- 0013_dashboard_functions
-- Everything the owner/manager dashboard does, as role-checked SQL functions (menu, tables, settings, staff, report,
-- audit log). Writes need an ACTIVE restaurant; reads keep working while suspended. Staff accounts need Supabase Auth
-- (done by the server with the service key), so the staff-writing functions are service_role-only and take the
-- owner's id explicitly and re-verify it. Idempotent. Rollback: drop the functions and the two unique indexes.
--
-- New error codes: GM018 category_not_empty, GM019 conflict (name/label/email already used),
--                  GM020 protected (owners are managed by the platform admin, not by themselves).

-- ---------- uniqueness that makes "same name twice" a friendly error instead of a confusing duplicate ----------
create unique index if not exists categories_name_uq on public.categories (restaurant_id, lower(name_en));
create unique index if not exists items_name_uq on public.items (category_id, lower(name_en));

-- ---------- audit: attribute service-role actions to the owner who asked, and keep reordering out of the log ----------
create or replace function private.write_audit(p_restaurant uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := coalesce(auth.uid(), nullif(current_setting('gotomenu.actor', true), '')::uuid);
begin
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, v_actor,
          coalesce((select s.role from public.staff s where s.user_id = v_actor),
                   case when exists (select 1 from public.platform_admins a where a.user_id = v_actor) then 'platform_admin' end),
          p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function private.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_skip text[] := array['qr_token','order_counter','sort_order'];
  v_row jsonb; v_old jsonb; v_diff jsonb; v_rid uuid; v_id text;
begin
  if coalesce(current_setting('gotomenu.audit_purge', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then v_row := to_jsonb(old) - v_skip; else v_row := to_jsonb(new) - v_skip; end if;
  v_diff := v_row;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - v_skip;
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into v_diff
      from jsonb_each(v_row) n join jsonb_each(v_old) o on o.key = n.key
      where n.value is distinct from o.value;
    if v_diff = '{}'::jsonb then return null; end if;
  end if;
  v_rid := coalesce((v_row->>'restaurant_id')::uuid, case when tg_table_name = 'restaurants' then (v_row->>'id')::uuid end);
  v_id  := coalesce(v_row->>'id', v_row->>'user_id');
  perform private.write_audit(v_rid, lower(tg_op), tg_table_name, v_id, v_diff);
  return null;
end $$;
revoke all on function private.audit_row() from public, anon, authenticated;

-- read access for owner/manager that does NOT require an active restaurant
create or replace function private.require_read(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null or not (v_role = any (p_roles)) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return v_rid;
end $$;
revoke all on function private.require_read(text[]) from public, anon, authenticated;

-- ---------- menu: read ----------
create or replace function public.mgr_get_menu() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return jsonb_build_object('categories', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name_en, 'active', c.active, 'sort_order', c.sort_order,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'name', i.name_en, 'description', i.description_en, 'price_paise', i.price_paise, 'diet', i.diet,
          'spice', i.spice, 'image_path', i.image_path, 'is_available', i.is_available, 'is_bestseller', i.is_bestseller,
          'is_chef_pick', i.is_chef_pick, 'sort_order', i.sort_order) order by i.sort_order, i.name_en)
        from public.items i where i.category_id = c.id and i.restaurant_id = v_rid), '[]'::jsonb))
      order by c.sort_order, c.name_en)
    from public.categories c where c.restaurant_id = v_rid), '[]'::jsonb));
end $$;

-- ---------- menu: categories ----------
create or replace function public.mgr_save_category(p_id uuid, p_name text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); v_name text := btrim(coalesce(p_name, '')); v_id uuid;
begin
  if char_length(v_name) not between 1 and 60 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from public.categories where restaurant_id = v_rid and lower(name_en) = lower(v_name) and id is distinct from p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  if p_id is null then
    insert into public.categories (restaurant_id, name_en, active, sort_order)
    values (v_rid, v_name, p_active, coalesce((select max(sort_order) + 1 from public.categories where restaurant_id = v_rid), 0))
    returning id into v_id;
  else
    update public.categories set name_en = v_name, active = p_active where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.mgr_delete_category(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  if not exists (select 1 from public.categories where id = p_id and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (select 1 from public.items where category_id = p_id) then
    raise exception using errcode = 'GM018', message = 'category_not_empty';
  end if;
  delete from public.categories where id = p_id and restaurant_id = v_rid;
end $$;

create or replace function public.mgr_reorder_categories(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 200 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.categories where restaurant_id = v_rid and id = any (p_ids)) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  update public.categories c set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality o(id, ord) where c.id = o.id and c.restaurant_id = v_rid;
end $$;

-- ---------- menu: items ----------
create or replace function public.mgr_save_item(
  p_id uuid, p_category uuid, p_name text, p_description text, p_price_paise int, p_diet text, p_spice int,
  p_image_path text, p_bestseller boolean, p_chef_pick boolean, p_available boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner','manager']);
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if char_length(v_name) not between 1 and 80 or (v_desc is not null and char_length(v_desc) > 300)
     or p_price_paise is null or p_price_paise not between 0 and 10000000
     or p_diet is null or p_diet not in ('veg','nonveg','egg','jain') or p_spice is null or p_spice not between 0 and 3
     or p_bestseller is null or p_chef_pick is null
     or (p_image_path is not null and (p_image_path not like v_rid::text || '/%' or p_image_path ~ '\.\.' or char_length(p_image_path) > 200)) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.categories where id = p_category and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (select 1 from public.items where category_id = p_category and lower(name_en) = lower(v_name) and id is distinct from p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  if p_id is null then
    insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice, image_path,
                              is_bestseller, is_chef_pick, is_available, sort_order)
    values (v_rid, p_category, v_name, v_desc, p_price_paise, p_diet, p_spice, p_image_path, p_bestseller, p_chef_pick,
            coalesce(p_available, true),
            coalesce((select max(sort_order) + 1 from public.items where category_id = p_category), 0))
    returning id into v_id;
  else
    update public.items set category_id = p_category, name_en = v_name, description_en = v_desc, price_paise = p_price_paise,
           diet = p_diet, spice = p_spice, image_path = p_image_path, is_bestseller = p_bestseller, is_chef_pick = p_chef_pick,
           is_available = coalesce(p_available, is_available)
     where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.mgr_delete_item(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  delete from public.items where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
end $$;

create or replace function public.mgr_duplicate_item(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); i public.items; v_name text; n int := 1; v_new uuid;
begin
  select * into i from public.items where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  v_name := left(i.name_en, 71) || ' (copy)';
  while exists (select 1 from public.items where category_id = i.category_id and lower(name_en) = lower(v_name)) loop
    n := n + 1;
    v_name := left(i.name_en, 68) || ' (copy ' || n || ')';
  end loop;
  insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice, image_path,
                            is_bestseller, is_chef_pick, is_available, sort_order)
  values (v_rid, i.category_id, v_name, i.description_en, i.price_paise, i.diet, i.spice, i.image_path, i.is_bestseller,
          i.is_chef_pick, i.is_available, coalesce((select max(sort_order) + 1 from public.items where category_id = i.category_id), 0))
  returning id into v_new;
  return v_new;
end $$;

create or replace function public.mgr_reorder_items(p_category uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 500 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.items where restaurant_id = v_rid and category_id = p_category and id = any (p_ids)) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  update public.items i set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality o(id, ord) where i.id = o.id and i.restaurant_id = v_rid;
end $$;

-- p_mode: percent (+/- %), add (+/- paise), set (exact paise). Every result must stay within 0 .. Rs 1,00,000.
create or replace function public.mgr_bulk_price(p_item_ids uuid[], p_mode text, p_value numeric) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); n int;
begin
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 300 or p_mode not in ('percent','add','set') or p_value is null
     or abs(p_value) > 100000000 or (p_mode = 'percent' and p_value < -100) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.items where restaurant_id = v_rid and id = any (p_item_ids)) <> (select count(distinct x) from unnest(p_item_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (
    select 1 from public.items i where i.restaurant_id = v_rid and i.id = any (p_item_ids)
      and (case p_mode when 'percent' then round(i.price_paise * (1 + p_value / 100.0)) when 'add' then i.price_paise + p_value else p_value end)
          not between 0 and 10000000) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.items i set price_paise = (case p_mode when 'percent' then round(i.price_paise * (1 + p_value / 100.0)) when 'add' then i.price_paise + p_value else p_value end)::int
   where i.restaurant_id = v_rid and i.id = any (p_item_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- CSV import: all-or-nothing. Returns {ok:false, errors:[{row,message}]} without touching anything if any row is invalid.
create or replace function public.mgr_import_items(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner','manager']);
  r record; v_errors jsonb := '[]'::jsonb; v_created int := 0; v_updated int := 0; v_cats int := 0;
  v_cat uuid; v_exists uuid; v_seen text[] := '{}'; v_key text; v_price numeric;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  for r in select e.value as j, e.ordinality as n from jsonb_array_elements(p_rows) with ordinality e loop
    begin
      v_price := (r.j->>'price_paise')::numeric;
      v_key := lower(btrim(r.j->>'category')) || '|' || lower(btrim(r.j->>'name'));
      if char_length(btrim(coalesce(r.j->>'category', ''))) not between 1 and 60 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Category must be 1 to 60 characters');
      elsif char_length(btrim(coalesce(r.j->>'name', ''))) not between 1 and 80 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Name must be 1 to 80 characters');
      elsif v_price is null or v_price <> trunc(v_price) or v_price not between 0 and 10000000 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Price must be between 0 and 1,00,000 rupees');
      elsif coalesce(r.j->>'diet', '') not in ('veg','nonveg','egg','jain') then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Diet must be veg, nonveg, egg or jain');
      elsif coalesce((r.j->>'spice')::int, -1) not between 0 and 3 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Spice must be 0, 1, 2 or 3');
      elsif char_length(coalesce(r.j->>'description', '')) > 300 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Description is longer than 300 characters');
      elsif v_key = any (v_seen) then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'This dish appears twice in the file');
      end if;
      v_seen := v_seen || v_key;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'This row could not be read');
    end;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  for r in select e.value as j from jsonb_array_elements(p_rows) with ordinality e order by e.ordinality loop
    select id into v_cat from public.categories where restaurant_id = v_rid and lower(name_en) = lower(btrim(r.j->>'category'));
    if v_cat is null then
      insert into public.categories (restaurant_id, name_en, sort_order)
      values (v_rid, btrim(r.j->>'category'), coalesce((select max(sort_order) + 1 from public.categories where restaurant_id = v_rid), 0))
      returning id into v_cat;
      v_cats := v_cats + 1;
    end if;
    select id into v_exists from public.items where category_id = v_cat and lower(name_en) = lower(btrim(r.j->>'name'));
    if v_exists is null then
      insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice, is_bestseller,
                                is_chef_pick, is_available, sort_order)
      values (v_rid, v_cat, btrim(r.j->>'name'), nullif(btrim(coalesce(r.j->>'description', '')), ''), (r.j->>'price_paise')::int,
              r.j->>'diet', (r.j->>'spice')::int, coalesce((r.j->>'bestseller')::boolean, false), coalesce((r.j->>'chef_pick')::boolean, false),
              coalesce((r.j->>'available')::boolean, true),
              coalesce((select max(sort_order) + 1 from public.items where category_id = v_cat), 0));
      v_created := v_created + 1;
    else
      update public.items set description_en = nullif(btrim(coalesce(r.j->>'description', '')), ''), price_paise = (r.j->>'price_paise')::int,
             diet = r.j->>'diet', spice = (r.j->>'spice')::int, is_bestseller = coalesce((r.j->>'bestseller')::boolean, false),
             is_chef_pick = coalesce((r.j->>'chef_pick')::boolean, false), is_available = coalesce((r.j->>'available')::boolean, true)
       where id = v_exists;
      v_updated := v_updated + 1;
    end if;
  end loop;
  perform private.write_audit(v_rid, 'menu_import', 'items', null, jsonb_build_object('created', v_created, 'updated', v_updated, 'categories_created', v_cats));
  return jsonb_build_object('ok', true, 'created', v_created, 'updated', v_updated, 'categories_created', v_cats);
end $$;

-- ---------- tables ----------
create or replace function public.mgr_save_table(p_id uuid, p_label text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); v_label text := btrim(coalesce(p_label, ''));
begin
  if char_length(v_label) not between 1 and 20 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from public.dining_tables where restaurant_id = v_rid and label = v_label and id <> p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  update public.dining_tables set label = v_label, active = p_active where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
end $$;

-- ---------- settings ----------
create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role())
          from public.restaurants r where r.id = v_rid);
end $$;

create or replace function public.mgr_update_settings(p_name text, p_review_url text, p_accent text, p_amber int, p_red int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']); v_name text := btrim(coalesce(p_name, '')); v_url text := nullif(btrim(coalesce(p_review_url, '')), '');
begin
  if char_length(v_name) not between 1 and 80
     or (v_url is not null and (v_url !~ '^https://[^[:space:]]+$' or char_length(v_url) > 500))
     or p_accent is null or p_accent not in ('saffron','tomato','emerald','teal','indigo','plum','rose','slate')
     or p_amber is null or p_red is null or p_amber not between 1 and 120 or p_red not between 2 and 240 or p_red <= p_amber then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.restaurants set name = v_name, review_url = v_url, accent = p_accent, amber_minutes = p_amber, red_minutes = p_red where id = v_rid;
end $$;

-- ---------- staff accounts ----------
create or replace function public.mgr_get_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', u.email, 'display_name', s.display_name,
                    'role', s.role, 'active', s.active, 'created_at', s.created_at, 'is_you', s.user_id = auth.uid())
                    order by case s.role when 'owner' then 0 when 'manager' then 1 when 'waiter' then 2 else 3 end, s.display_name)
                   from public.staff s join auth.users u on u.id = s.user_id where s.restaurant_id = v_rid), '[]'::jsonb);
end $$;

-- service_role only: the server has just created the Auth user; p_owner is the signed-in owner asking for it.
create or replace function private.require_owner_of(p_owner uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_status text;
begin
  select s.restaurant_id, r.status into v_rid, v_status from public.staff s join public.restaurants r on r.id = s.restaurant_id
   where s.user_id = p_owner and s.role = 'owner' and s.active;
  if v_rid is null then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  if v_status <> 'active' then raise exception using errcode = 'GM001', message = 'restaurant_suspended'; end if;
  return v_rid;
end $$;
revoke all on function private.require_owner_of(uuid) from public, anon, authenticated;

create or replace function public.owner_add_staff(p_owner uuid, p_user uuid, p_role text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_owner_of(p_owner); v_name text := btrim(coalesce(p_name, ''));
begin
  if p_role not in ('manager','waiter','kitchen') or char_length(v_name) not between 1 and 60 or p_user is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  perform set_config('gotomenu.actor', p_owner::text, true);
  insert into public.staff (user_id, restaurant_id, role, display_name) values (p_user, v_rid, p_role, v_name);
  return p_user;
exception when unique_violation then
  raise exception using errcode = 'GM019', message = 'conflict';
end $$;

create or replace function public.owner_set_staff(p_owner uuid, p_user uuid, p_role text, p_name text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_owner_of(p_owner); t public.staff; v_name text := btrim(coalesce(p_name, ''));
begin
  if p_role not in ('manager','waiter','kitchen') or char_length(v_name) not between 1 and 60 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into t from public.staff where user_id = p_user and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if t.role = 'owner' then raise exception using errcode = 'GM020', message = 'protected'; end if;
  perform set_config('gotomenu.actor', p_owner::text, true);
  update public.staff set role = p_role, display_name = v_name, active = p_active where user_id = p_user;
end $$;

-- used before a password reset: the target must be a non-owner member of the caller's restaurant
create or replace function public.owner_check_staff(p_owner uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_owner_of(p_owner);
begin
  if not exists (select 1 from public.staff where user_id = p_user and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (select 1 from public.staff where user_id = p_user and role = 'owner') then
    raise exception using errcode = 'GM020', message = 'protected';
  end if;
  perform set_config('gotomenu.actor', p_owner::text, true);
  perform private.write_audit(v_rid, 'staff_password_reset', 'staff', p_user::text, '{}'::jsonb);
  return true;
end $$;

-- ---------- report (days are Indian days: Asia/Kolkata) ----------
create or replace function public.mgr_report(p_range text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_read(array['owner','manager']);
  v_days int := case p_range when 'today' then 1 when '7d' then 7 when '30d' then 30 end;
  v_from timestamptz; v_orders int; v_revenue bigint; v_cancelled int;
begin
  if v_days is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  v_from := (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => v_days - 1)) at time zone 'Asia/Kolkata';
  select count(*) filter (where status <> 'cancelled'), coalesce(sum(total_paise) filter (where status <> 'cancelled'), 0), count(*) filter (where status = 'cancelled')
    into v_orders, v_revenue, v_cancelled from public.orders where restaurant_id = v_rid and created_at >= v_from;
  return jsonb_build_object(
    'range', p_range, 'from', v_from,
    'orders', v_orders, 'cancelled', v_cancelled, 'revenue_paise', v_revenue,
    'average_order_paise', case when v_orders = 0 then 0 else round(v_revenue::numeric / v_orders) end,
    'review_taps', (select count(*) from public.review_clicks where restaurant_id = v_rid and created_at >= v_from),
    'top_dishes', coalesce((select jsonb_agg(t) from (
        select oi.name_en_snapshot as name, sum(oi.qty)::int as qty, sum(oi.qty::bigint * oi.unit_price_paise) as revenue_paise
          from public.order_items oi join public.orders o on o.id = oi.order_id
         where oi.restaurant_id = v_rid and o.created_at >= v_from and o.status <> 'cancelled'
         group by oi.name_en_snapshot order by sum(oi.qty) desc, oi.name_en_snapshot limit 10) t), '[]'::jsonb),
    'peak_hours', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'orders', coalesce(c.n, 0)) order by h)
        from generate_series(0, 23) h left join (
          select extract(hour from created_at at time zone 'Asia/Kolkata')::int as hr, count(*)::int as n
            from public.orders where restaurant_id = v_rid and created_at >= v_from and status <> 'cancelled' group by 1) c on c.hr = h), '[]'::jsonb));
end $$;

-- ---------- audit log viewer ----------
create or replace function public.mgr_get_audit(p_limit int default 100, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return coalesce((select jsonb_agg(t order by t.id desc) from (
    select a.id, a.created_at, a.action, a.entity, a.entity_id, a.details, a.actor_role,
           case when a.actor_role = 'platform_admin' then 'Platform admin' else coalesce(s.display_name, 'System') end as actor_name
      from public.audit_log a left join public.staff s on s.user_id = a.actor_user_id
     where a.restaurant_id = v_rid and (p_before is null or a.id < p_before)
     order by a.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) t), '[]'::jsonb);
end $$;

-- ---------- grants ----------
revoke all on function public.mgr_get_menu(), public.mgr_save_category(uuid, text, boolean), public.mgr_delete_category(uuid),
  public.mgr_reorder_categories(uuid[]),
  public.mgr_save_item(uuid, uuid, text, text, int, text, int, text, boolean, boolean, boolean), public.mgr_delete_item(uuid),
  public.mgr_duplicate_item(uuid), public.mgr_reorder_items(uuid, uuid[]), public.mgr_bulk_price(uuid[], text, numeric),
  public.mgr_import_items(jsonb), public.mgr_save_table(uuid, text, boolean), public.mgr_get_settings(),
  public.mgr_update_settings(text, text, text, int, int), public.mgr_get_staff(), public.mgr_report(text), public.mgr_get_audit(int, bigint),
  public.owner_add_staff(uuid, uuid, text, text), public.owner_set_staff(uuid, uuid, text, text, boolean), public.owner_check_staff(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mgr_get_menu(), public.mgr_save_category(uuid, text, boolean), public.mgr_delete_category(uuid),
  public.mgr_reorder_categories(uuid[]),
  public.mgr_save_item(uuid, uuid, text, text, int, text, int, text, boolean, boolean, boolean), public.mgr_delete_item(uuid),
  public.mgr_duplicate_item(uuid), public.mgr_reorder_items(uuid, uuid[]), public.mgr_bulk_price(uuid[], text, numeric),
  public.mgr_import_items(jsonb), public.mgr_save_table(uuid, text, boolean), public.mgr_get_settings(),
  public.mgr_update_settings(text, text, text, int, int), public.mgr_get_staff(), public.mgr_report(text), public.mgr_get_audit(int, bigint)
  to authenticated;
grant execute on function public.owner_add_staff(uuid, uuid, text, text), public.owner_set_staff(uuid, uuid, text, text, boolean),
  public.owner_check_staff(uuid, uuid) to service_role;

-- ================= 0014_mfa_enforcement.sql =================
-- 0014_mfa_enforcement
-- Owners and managers (who can change prices, staff and settings) must have signed in with a second factor (TOTP, "aal2").
-- Enforced HERE, in the database, as well as in the app: a stolen password alone cannot read or change anything of theirs.
-- Waiters and kitchen staff are not required to use a second factor. Idempotent. Rollback: re-run 0003 / 0006 / 0011 / 0013 definitions.

create or replace function private.is_aal2() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'aal', '') = 'aal2'
$$;

create or replace function private.require_mfa(p_role text) returns void
language plpgsql stable set search_path = '' as $$
begin
  if p_role in ('owner', 'manager') and not private.is_aal2() then
    raise exception using errcode = 'GM021', message = 'mfa_required';
  end if;
end $$;
revoke all on function private.is_aal2(), private.require_mfa(text) from public, anon;
grant execute on function private.is_aal2(), private.require_mfa(text) to authenticated;

-- RLS helpers: an owner/manager without a second factor is "nobody" to every policy
create or replace function private.my_restaurant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.restaurant_id from public.staff s where s.user_id = auth.uid() and s.active and (s.role not in ('owner','manager') or private.is_aal2())
$$;
create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s where s.user_id = auth.uid() and s.active and (s.role not in ('owner','manager') or private.is_aal2())
$$;
create or replace function private.my_restaurant_is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active and (s.role not in ('owner','manager') or private.is_aal2())), false)
$$;
create or replace function private.can_manage() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.role in ('owner','manager') and r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active and private.is_aal2()), false)
$$;
create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.role = 'owner' and r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active and private.is_aal2()), false)
$$;

create or replace function private.require_staff(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text; v_status text;
begin
  select s.restaurant_id, s.role, r.status into v_rid, v_role, v_status
    from public.staff s join public.restaurants r on r.id = s.restaurant_id
   where s.user_id = auth.uid() and s.active;
  if v_rid is null or not (v_role = any (p_roles)) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  perform private.require_mfa(v_role);
  if v_status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  return v_rid;
end $$;
revoke all on function private.require_staff(text[]) from public, anon, authenticated;

create or replace function private.require_read(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null or not (v_role = any (p_roles)) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  perform private.require_mfa(v_role);
  return v_rid;
end $$;
revoke all on function private.require_read(text[]) from public, anon, authenticated;

create or replace function public.staff_get_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  perform private.require_mfa(v_role);
  return jsonb_build_object(
    'server_time', now(),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status, 'table_label', t.label, 'session_id', o.session_id,
        'note', o.note, 'total_paise', o.total_paise, 'created_at', o.created_at, 'preparing_at', o.preparing_at,
        'ready_at', o.ready_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_en_snapshot, 'qty', oi.qty, 'note', oi.note)
                                            order by oi.name_en_snapshot)
                           from public.order_items oi where oi.order_id = o.id), '[]'::jsonb))
        order by o.created_at)
      from public.orders o
      join public.dining_tables t on t.id = o.table_id
      join public.table_sessions s on s.id = o.session_id
      where o.restaurant_id = v_rid and s.closed_at is null and o.status in ('placed', 'preparing', 'ready')), '[]'::jsonb),
    -- the kitchen does not handle waiter calls, bills or payment
    'requests', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode, 'table_label', t.label,
        'session_id', q.session_id, 'created_at', q.created_at) order by q.created_at)
      from public.service_requests q join public.dining_tables t on t.id = q.table_id
      where q.restaurant_id = v_rid and q.status = 'open'), '[]'::jsonb) end,
    'sessions', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'table_label', t.label, 'opened_at', s.opened_at, 'pay_mode', s.pay_mode,
        'bill_requested_at', s.bill_requested_at,
        'total_paise', coalesce((select sum(o.total_paise) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'), 0),
        'orders_count', (select count(*) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'),
        'unserved_count', (select count(*) from public.orders o where o.session_id = s.id and o.status in ('placed', 'preparing', 'ready')))
        order by s.opened_at)
      from public.table_sessions s join public.dining_tables t on t.id = s.table_id
      where s.restaurant_id = v_rid and s.closed_at is null), '[]'::jsonb) end);
end $$;

create or replace function public.staff_list_items() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  perform private.require_mfa(v_role);
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name_en, 'category', c.name_en, 'diet', i.diet,
                                        'price_paise', i.price_paise, 'is_available', i.is_available)
                     order by c.sort_order, c.name_en, i.sort_order, i.name_en)
    from public.items i join public.categories c on c.id = i.category_id
    where i.restaurant_id = v_rid), '[]'::jsonb);
end $$;

-- Platform admins: the server asks this (service role only) before showing /admin.
create or replace function public.admin_check(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = p_user)
$$;
revoke all on function public.admin_check(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_check(uuid) to service_role;

-- ================= 0015_staff_password_only.sql =================
-- 0015_staff_password_only
-- Owner decision: restaurant owners and managers sign in with email + password only (no authenticator app).
-- The second factor stays REQUIRED for platform admins, enforced in the app (/admin pages and /api/admin/*).
-- This migration restores the role checks to "role + restaurant + active" and removes the aal2 conditions added in 0014.
-- Idempotent (create or replace). Rollback: re-run 0014.

create or replace function private.my_restaurant_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.restaurant_id from public.staff s where s.user_id = auth.uid() and s.active
$$;

create or replace function private.my_role() returns text
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s where s.user_id = auth.uid() and s.active
$$;

create or replace function private.my_restaurant_is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active), false)
$$;

create or replace function private.can_manage() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.role in ('owner','manager') and r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active), false)
$$;

create or replace function private.is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.role = 'owner' and r.status = 'active'
                   from public.staff s join public.restaurants r on r.id = s.restaurant_id
                   where s.user_id = auth.uid() and s.active), false)
$$;

create or replace function private.require_staff(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text; v_status text;
begin
  select s.restaurant_id, s.role, r.status into v_rid, v_role, v_status
    from public.staff s join public.restaurants r on r.id = s.restaurant_id
   where s.user_id = auth.uid() and s.active;
  if v_rid is null or not (v_role = any (p_roles)) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  if v_status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  return v_rid;
end $$;

create or replace function private.require_read(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null or not (v_role = any (p_roles)) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return v_rid;
end $$;

create or replace function public.staff_get_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return jsonb_build_object(
    'server_time', now(),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status, 'table_label', t.label, 'session_id', o.session_id,
        'note', o.note, 'total_paise', o.total_paise, 'created_at', o.created_at, 'preparing_at', o.preparing_at,
        'ready_at', o.ready_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_en_snapshot, 'qty', oi.qty, 'note', oi.note)
                                            order by oi.name_en_snapshot)
                           from public.order_items oi where oi.order_id = o.id), '[]'::jsonb))
        order by o.created_at)
      from public.orders o
      join public.dining_tables t on t.id = o.table_id
      join public.table_sessions s on s.id = o.session_id
      where o.restaurant_id = v_rid and s.closed_at is null and o.status in ('placed', 'preparing', 'ready')), '[]'::jsonb),
    -- the kitchen does not handle waiter calls, bills or payment
    'requests', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode, 'table_label', t.label,
        'session_id', q.session_id, 'created_at', q.created_at) order by q.created_at)
      from public.service_requests q join public.dining_tables t on t.id = q.table_id
      where q.restaurant_id = v_rid and q.status = 'open'), '[]'::jsonb) end,
    'sessions', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'table_label', t.label, 'opened_at', s.opened_at, 'pay_mode', s.pay_mode,
        'bill_requested_at', s.bill_requested_at,
        'total_paise', coalesce((select sum(o.total_paise) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'), 0),
        'orders_count', (select count(*) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'),
        'unserved_count', (select count(*) from public.orders o where o.session_id = s.id and o.status in ('placed', 'preparing', 'ready')))
        order by s.opened_at)
      from public.table_sessions s join public.dining_tables t on t.id = s.table_id
      where s.restaurant_id = v_rid and s.closed_at is null), '[]'::jsonb) end);
end $$;

create or replace function public.staff_list_items() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name_en, 'category', c.name_en, 'diet', i.diet,
                                        'price_paise', i.price_paise, 'is_available', i.is_available)
                     order by c.sort_order, c.name_en, i.sort_order, i.name_en)
    from public.items i join public.categories c on c.id = i.category_id
    where i.restaurant_id = v_rid), '[]'::jsonb);
end $$;

revoke all on function private.require_staff(text[]), private.require_read(text[]) from public, anon, authenticated;
revoke all on function private.my_restaurant_id(), private.my_role(), private.my_restaurant_is_active(), private.can_manage(), private.is_owner() from public, anon;
grant execute on function private.my_restaurant_id(), private.my_role(), private.my_restaurant_is_active(), private.can_manage(), private.is_owner() to authenticated;

-- ================= 0016_admin_staff_support.sql =================
-- 0016_admin_staff_support
-- Platform admin can see a restaurant's logins and (through the server, which uses the Auth admin API) reset a
-- password or correct an email. service_role only; each function re-checks the platform_admins row and audits.
-- Idempotent. Rollback: drop the two functions.

create or replace function public.admin_list_staff(p_admin uuid, p_restaurant uuid)
returns table (user_id uuid, role text, display_name text, active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  return query
    select s.user_id, s.role, s.display_name, s.active
      from public.staff s where s.restaurant_id = p_restaurant
     order by (s.role = 'owner') desc, s.created_at;
end $$;

create or replace function public.admin_check_staff(p_admin uuid, p_restaurant uuid, p_user uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  if p_action not in ('staff_password_reset', 'staff_email_changed') then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if not exists (select 1 from public.staff where user_id = p_user and restaurant_id = p_restaurant) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', p_action, 'staff', p_user::text, '{}'::jsonb);
end $$;

revoke all on function public.admin_list_staff(uuid, uuid), public.admin_check_staff(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.admin_list_staff(uuid, uuid), public.admin_check_staff(uuid, uuid, uuid, text) to service_role;

-- Platform admin adds a login (owner, manager, waiter or kitchen) to a restaurant.
create or replace function public.admin_add_staff(p_admin uuid, p_restaurant uuid, p_user uuid, p_role text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_admin(p_admin);
  if p_role not in ('owner', 'manager', 'waiter', 'kitchen') or char_length(v_name) not between 1 and 60 or p_user is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.restaurants where id = p_restaurant) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  insert into public.staff (user_id, restaurant_id, role, display_name) values (p_user, p_restaurant, p_role, v_name);
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'staff_added', 'staff', p_user::text, jsonb_build_object('role', p_role));
  return p_user;
exception when unique_violation then
  raise exception using errcode = 'GM019', message = 'conflict';
end $$;
revoke all on function public.admin_add_staff(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.admin_add_staff(uuid, uuid, uuid, text, text) to service_role;

-- ================= 0017_restaurant_profile.sql =================
-- 0017_restaurant_profile
-- Public restaurant profile: tagline, description, logo, banner, contact, WhatsApp, address, opening hours text,
-- Instagram. Everything here is intended for customers to see (the public menu exposes it).
-- Idempotent. Rollback: drop the columns and the function; restore guest_get_menu / mgr_get_settings from 0005 / 0013.

alter table public.restaurants
  add column if not exists tagline       text,
  add column if not exists description   text,
  add column if not exists logo_path     text,
  add column if not exists banner_path   text,
  add column if not exists phone         text,
  add column if not exists whatsapp      text,
  add column if not exists address       text,
  add column if not exists hours_text    text,
  add column if not exists instagram_url text;

do $$ begin
  alter table public.restaurants
    add constraint restaurants_tagline_len check (tagline is null or char_length(tagline) <= 120),
    add constraint restaurants_description_len check (description is null or char_length(description) <= 400),
    add constraint restaurants_logo_path check (logo_path is null or (logo_path like id::text || '/%' and logo_path !~ '\.\.' and char_length(logo_path) <= 200)),
    add constraint restaurants_banner_path check (banner_path is null or (banner_path like id::text || '/%' and banner_path !~ '\.\.' and char_length(banner_path) <= 200)),
    add constraint restaurants_phone_fmt check (phone is null or phone ~ '^[0-9]{10,15}$'),
    add constraint restaurants_whatsapp_fmt check (whatsapp is null or whatsapp ~ '^[0-9]{10,15}$'),
    add constraint restaurants_address_len check (address is null or char_length(address) <= 200),
    add constraint restaurants_hours_len check (hours_text is null or char_length(hours_text) <= 200),
    add constraint restaurants_instagram_url check (instagram_url is null or (instagram_url ~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._/-]+$' and char_length(instagram_url) <= 200));
exception when duplicate_object then null;
end $$;

-- Owner (only) edits the profile. Blank text becomes NULL.
create or replace function public.mgr_update_profile(
  p_tagline text, p_description text, p_logo text, p_banner text, p_phone text, p_whatsapp text,
  p_address text, p_hours text, p_instagram text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']);
begin
  update public.restaurants set
    tagline = nullif(btrim(coalesce(p_tagline, '')), ''),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    logo_path = nullif(btrim(coalesce(p_logo, '')), ''),
    banner_path = nullif(btrim(coalesce(p_banner, '')), ''),
    phone = nullif(btrim(coalesce(p_phone, '')), ''),
    whatsapp = nullif(btrim(coalesce(p_whatsapp, '')), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    hours_text = nullif(btrim(coalesce(p_hours, '')), ''),
    instagram_url = nullif(btrim(coalesce(p_instagram, '')), '')
  where id = v_rid;
exception when check_violation then
  raise exception using errcode = 'GM015', message = 'invalid_input';
end $$;
revoke all on function public.mgr_update_profile(text, text, text, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.mgr_update_profile(text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role(), 'id', r.id,
            'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
            'phone', r.phone, 'whatsapp', r.whatsapp, 'address', r.address, 'hours_text', r.hours_text,
            'instagram_url', r.instagram_url)
          from public.restaurants r where r.id = v_rid);
end $$;

create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'phone', r.phone, 'whatsapp', r.whatsapp, 'address', r.address, 'hours_text', r.hours_text,
      'instagram_url', r.instagram_url, 'review_url', r.review_url),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick)
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;

-- ================= 0018_menu_analytics.sql =================
-- 0018_menu_analytics
-- Privacy-conscious menu analytics. A visit is identified only by a random per-tab id made in the browser
-- (sessionStorage, never a cookie, no IP, no user agent stored). Events are recorded by a service_role-only
-- function that rate-limits, de-duplicates and purges events older than 180 days. Owners and managers read
-- aggregated numbers through mgr_analytics(); nobody can read the raw table directly.
-- Idempotent. Rollback: drop the two functions and the table.

create table if not exists public.menu_events (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  visit_id      uuid not null,
  event         text not null,
  item_id       uuid,
  category_id   uuid,
  table_id      uuid,
  created_at    timestamptz not null default now(),
  constraint menu_events_event check (event in (
    'menu_opened','qr_landing','category_viewed','item_viewed','search',
    'whatsapp_click','call_click','directions_click','instagram_click','google_review_click','cart_add'))
);
create index if not exists menu_events_restaurant_time_idx on public.menu_events (restaurant_id, created_at desc);
create index if not exists menu_events_dedupe_idx on public.menu_events (restaurant_id, visit_id, event, created_at desc);
alter table public.menu_events enable row level security;
revoke all on public.menu_events from public, anon, authenticated;

create or replace function public.guest_record_event(
  p_slug text, p_token text, p_visit uuid, p_event text, p_item uuid, p_category uuid, p_ip_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table uuid;
  v_window interval;
begin
  select * into r from public.restaurants where slug = p_slug and status = 'active';
  if not found then return false; end if;
  if p_visit is null or p_event is null then return false; end if;
  -- generous per-address cap (cafes share one wifi address); events beyond it are silently dropped
  if p_ip_hash is not null and not private.rl_hit('ev:' || p_ip_hash, 600, 600) then return false; end if;
  if p_token is not null then
    select t.id into v_table from public.dining_tables t where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  if p_event = 'qr_landing' and v_table is null then return false; end if;
  -- the item / category must belong to this restaurant, otherwise ignore the reference
  if p_item is not null and not exists (select 1 from public.items where id = p_item and restaurant_id = r.id) then p_item := null; end if;
  if p_category is not null and not exists (select 1 from public.categories where id = p_category and restaurant_id = r.id) then p_category := null; end if;
  if p_event in ('item_viewed','category_viewed') and coalesce(p_item, p_category) is null then return false; end if;
  -- de-duplication: opening and viewing count once per visit per 30 minutes; taps and searches once per 10 seconds
  v_window := case when p_event in ('menu_opened','qr_landing','item_viewed','category_viewed') then interval '30 minutes' else interval '10 seconds' end;
  if exists (select 1 from public.menu_events e where e.restaurant_id = r.id and e.visit_id = p_visit and e.event = p_event
               and e.item_id is not distinct from p_item and e.category_id is not distinct from p_category
               and e.created_at > now() - v_window) then
    return false;
  end if;
  insert into public.menu_events (restaurant_id, visit_id, event, item_id, category_id, table_id)
  values (r.id, p_visit, p_event, p_item, p_category, v_table);
  -- retention: drop old rows a few at a time so the table never grows without bound
  delete from public.menu_events where id in (select id from public.menu_events where created_at < now() - interval '180 days' limit 200);
  return true;
end $$;
revoke all on function public.guest_record_event(text, text, uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.guest_record_event(text, text, uuid, text, uuid, uuid, text) to service_role;

create or replace function public.mgr_analytics(p_range text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_read(array['owner','manager']);
  v_days int := case p_range when '7d' then 7 when '30d' then 30 when '90d' then 90 end;
  v_from timestamptz;
begin
  if v_days is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  v_from := (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => v_days - 1)) at time zone 'Asia/Kolkata';
  return jsonb_build_object(
    'range', p_range, 'from', v_from,
    'totals', (select jsonb_build_object(
        'menu_opens', count(*) filter (where event = 'menu_opened'),
        'visits', count(distinct visit_id),
        'qr_landings', count(*) filter (where event = 'qr_landing'),
        'item_views', count(*) filter (where event = 'item_viewed'),
        'searches', count(*) filter (where event = 'search'),
        'cart_adds', count(*) filter (where event = 'cart_add'),
        'whatsapp', count(*) filter (where event = 'whatsapp_click'),
        'calls', count(*) filter (where event = 'call_click'),
        'directions', count(*) filter (where event = 'directions_click'),
        'instagram', count(*) filter (where event = 'instagram_click'),
        'google_review', count(*) filter (where event = 'google_review_click'))
      from public.menu_events where restaurant_id = v_rid and created_at >= v_from),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'opens', coalesce(c.opens, 0), 'visits', coalesce(c.visits, 0)) order by d)
        from generate_series((v_from at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d
        left join (select (created_at at time zone 'Asia/Kolkata')::date as day,
                          count(*) filter (where event = 'menu_opened')::int as opens, count(distinct visit_id)::int as visits
                     from public.menu_events where restaurant_id = v_rid and created_at >= v_from group by 1) c on c.day = d::date), '[]'::jsonb),
    'top_items', coalesce((select jsonb_agg(t) from (
        select i.name_en as name, count(*)::int as views
          from public.menu_events e join public.items i on i.id = e.item_id and i.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'item_viewed' and e.created_at >= v_from
         group by i.name_en order by count(*) desc, i.name_en limit 10) t), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(t) from (
        select c.name_en as name, count(*)::int as views
          from public.menu_events e join public.categories c on c.id = e.category_id and c.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'category_viewed' and e.created_at >= v_from
         group by c.name_en order by count(*) desc, c.name_en limit 10) t), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(t) from (
        select dt.label as label, count(*)::int as scans
          from public.menu_events e join public.dining_tables dt on dt.id = e.table_id and dt.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'qr_landing' and e.created_at >= v_from
         group by dt.label order by count(*) desc, dt.label limit 20) t), '[]'::jsonb));
end $$;
revoke all on function public.mgr_analytics(text) from public, anon, service_role;
grant execute on function public.mgr_analytics(text) to authenticated;

-- ================= 0019_order_location_check.sql =================
-- 0019_order_location_check
-- Optional "only take orders near the cafe" rule. The owner saves the cafe's position, a radius and a switch.
-- The server asks guest_check_location() before it places an order. A guest's coordinates are used for that one
-- check and are never stored. Honest limit: phone location can be switched off or faked, so this reduces casual
-- ordering from home, it is not proof of presence.
-- Idempotent. Rollback: drop the two functions and the four columns; restore mgr_get_settings from 0017.

alter table public.restaurants
  add column if not exists geo_required   boolean not null default false,
  add column if not exists geo_lat        double precision,
  add column if not exists geo_lng        double precision,
  add column if not exists geo_radius_m   int not null default 150;

do $$ begin
  alter table public.restaurants
    add constraint restaurants_geo_range check ((geo_lat is null or geo_lat between -90 and 90) and (geo_lng is null or geo_lng between -180 and 180)),
    add constraint restaurants_geo_radius check (geo_radius_m between 50 and 2000),
    add constraint restaurants_geo_complete check (not geo_required or (geo_lat is not null and geo_lng is not null));
exception when duplicate_object then null;
end $$;

-- 'ok' | 'required' (no position sent) | 'inaccurate' (phone could not fix its position well) | 'too_far'
create or replace function public.guest_check_location(p_slug text, p_lat double precision, p_lng double precision, p_acc double precision)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_dist double precision;
  a double precision;
  b double precision;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found or not r.geo_required then return 'ok'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return 'required'; end if;
  if p_acc is null or p_acc < 0 or p_acc > 500 then return 'inaccurate'; end if;
  a := sin(radians(p_lat - r.geo_lat) / 2) ^ 2 + cos(radians(r.geo_lat)) * cos(radians(p_lat)) * sin(radians(p_lng - r.geo_lng) / 2) ^ 2;
  v_dist := 2 * 6371000 * asin(least(1, sqrt(a)));
  -- the phone's own accuracy estimate gives the guest the benefit of the doubt, up to 200 m
  if v_dist > r.geo_radius_m + least(p_acc, 200) then return 'too_far'; end if;
  return 'ok';
end $$;
revoke all on function public.guest_check_location(text, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.guest_check_location(text, double precision, double precision, double precision) to service_role;

create or replace function public.mgr_update_location(p_required boolean, p_lat double precision, p_lng double precision, p_radius int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']);
begin
  if p_required is null or p_radius is null or p_radius not between 50 and 2000
     or (p_required and (p_lat is null or p_lng is null))
     or (p_lat is not null and p_lat not between -90 and 90) or (p_lng is not null and p_lng not between -180 and 180) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.restaurants set geo_required = p_required, geo_lat = p_lat, geo_lng = p_lng, geo_radius_m = p_radius where id = v_rid;
end $$;
revoke all on function public.mgr_update_location(boolean, double precision, double precision, int) from public, anon, service_role;
grant execute on function public.mgr_update_location(boolean, double precision, double precision, int) to authenticated;

create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role(), 'id', r.id,
            'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
            'phone', r.phone, 'whatsapp', r.whatsapp, 'address', r.address, 'hours_text', r.hours_text,
            'instagram_url', r.instagram_url,
            'geo_required', r.geo_required, 'geo_lat', r.geo_lat, 'geo_lng', r.geo_lng, 'geo_radius_m', r.geo_radius_m)
          from public.restaurants r where r.id = v_rid);
end $$;

-- ================= 0020_explore_link.sql =================
-- 0020_explore_link
-- The public menu no longer shows Call / WhatsApp / Instagram / Directions / Google-review buttons. It shows one
-- button, "Explore more before leaving", that opens https://smarty.taprizz.in/sq/<code>. The owner types only <code>.
-- The old phone / whatsapp / instagram columns stay in the table (unused, nothing reads or shows them).
-- Idempotent. Rollback: restore guest_get_menu / mgr_get_settings / mgr_update_profile / mgr_analytics from 0017 / 0018.

alter table public.restaurants add column if not exists explore_code text;
do $$ begin
  alter table public.restaurants add constraint restaurants_explore_code check (explore_code is null or explore_code ~ '^[A-Za-z0-9_-]{1,64}$');
exception when duplicate_object then null;
end $$;

alter table public.menu_events drop constraint if exists menu_events_event;
alter table public.menu_events add constraint menu_events_event check (event in (
  'menu_opened','qr_landing','category_viewed','item_viewed','search',
  'whatsapp_click','call_click','directions_click','instagram_click','google_review_click','cart_add','explore_click'));

drop function if exists public.mgr_update_profile(text, text, text, text, text, text, text, text, text);
create or replace function public.mgr_update_profile(
  p_tagline text, p_description text, p_logo text, p_banner text, p_address text, p_hours text, p_explore text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']);
begin
  update public.restaurants set
    tagline = nullif(btrim(coalesce(p_tagline, '')), ''),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    logo_path = nullif(btrim(coalesce(p_logo, '')), ''),
    banner_path = nullif(btrim(coalesce(p_banner, '')), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    hours_text = nullif(btrim(coalesce(p_hours, '')), ''),
    explore_code = nullif(btrim(coalesce(p_explore, '')), '')
  where id = v_rid;
exception when check_violation then
  raise exception using errcode = 'GM015', message = 'invalid_input';
end $$;
revoke all on function public.mgr_update_profile(text, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.mgr_update_profile(text, text, text, text, text, text, text) to authenticated;

create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role(), 'id', r.id,
            'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
            'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code,
            'geo_required', r.geo_required, 'geo_lat', r.geo_lat, 'geo_lng', r.geo_lng, 'geo_radius_m', r.geo_radius_m)
          from public.restaurants r where r.id = v_rid);
end $$;

create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick)
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;

create or replace function public.mgr_analytics(p_range text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_read(array['owner','manager']);
  v_days int := case p_range when '7d' then 7 when '30d' then 30 when '90d' then 90 end;
  v_from timestamptz;
begin
  if v_days is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  v_from := (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => v_days - 1)) at time zone 'Asia/Kolkata';
  return jsonb_build_object(
    'range', p_range, 'from', v_from,
    'totals', (select jsonb_build_object(
        'menu_opens', count(*) filter (where event = 'menu_opened'),
        'visits', count(distinct visit_id),
        'qr_landings', count(*) filter (where event = 'qr_landing'),
        'item_views', count(*) filter (where event = 'item_viewed'),
        'searches', count(*) filter (where event = 'search'),
        'cart_adds', count(*) filter (where event = 'cart_add'),
        'whatsapp', count(*) filter (where event = 'whatsapp_click'),
        'calls', count(*) filter (where event = 'call_click'),
        'directions', count(*) filter (where event = 'directions_click'),
        'instagram', count(*) filter (where event = 'instagram_click'),
        'google_review', count(*) filter (where event = 'google_review_click'),
        'explore', count(*) filter (where event = 'explore_click'))
      from public.menu_events where restaurant_id = v_rid and created_at >= v_from),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'opens', coalesce(c.opens, 0), 'visits', coalesce(c.visits, 0)) order by d)
        from generate_series((v_from at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d
        left join (select (created_at at time zone 'Asia/Kolkata')::date as day,
                          count(*) filter (where event = 'menu_opened')::int as opens, count(distinct visit_id)::int as visits
                     from public.menu_events where restaurant_id = v_rid and created_at >= v_from group by 1) c on c.day = d::date), '[]'::jsonb),
    'top_items', coalesce((select jsonb_agg(t) from (
        select i.name_en as name, count(*)::int as views
          from public.menu_events e join public.items i on i.id = e.item_id and i.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'item_viewed' and e.created_at >= v_from
         group by i.name_en order by count(*) desc, i.name_en limit 10) t), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(t) from (
        select c.name_en as name, count(*)::int as views
          from public.menu_events e join public.categories c on c.id = e.category_id and c.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'category_viewed' and e.created_at >= v_from
         group by c.name_en order by count(*) desc, c.name_en limit 10) t), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(t) from (
        select dt.label as label, count(*)::int as scans
          from public.menu_events e join public.dining_tables dt on dt.id = e.table_id and dt.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'qr_landing' and e.created_at >= v_from
         group by dt.label order by count(*) desc, dt.label limit 20) t), '[]'::jsonb));
end $$;
revoke all on function public.mgr_analytics(text) from public, anon, service_role;
grant execute on function public.mgr_analytics(text) to authenticated;

-- ================= 0021_plans_billing.sql =================
-- 0021_plans_billing
-- Plans are defined by the platform admin (name, bullet points, setup fee, monthly and yearly price). Each restaurant
-- is assigned a plan with its OWN price, billing period, start and end date, so any deal can be set by hand. The end
-- date can optionally pause the menu automatically (after a grace period). Also: rename a restaurant or a login,
-- and duplicate a restaurant (menu, categories, look) as a starting point for a new client.
-- Service-role only functions; each re-checks platform_admins and writes an audit row. Idempotent.
-- Rollback: drop the functions and columns below; restore admin_list_restaurants from 0008, guest_get_menu from 0020.

create table if not exists public.plans (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  points          text[] not null default '{}',
  setup_fee_paise int not null default 0,
  monthly_paise   int not null default 0,
  yearly_paise    int not null default 0,
  active          boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  constraint plans_name_len check (char_length(name) between 1 and 40),
  constraint plans_points_len check (coalesce(array_length(points, 1), 0) <= 20),
  constraint plans_prices check (setup_fee_paise between 0 and 100000000 and monthly_paise between 0 and 100000000 and yearly_paise between 0 and 100000000)
);
create unique index if not exists plans_name_uq on public.plans (lower(name));
alter table public.plans enable row level security;
revoke all on public.plans from public, anon, authenticated;

alter table public.restaurants
  add column if not exists plan_id          uuid references public.plans (id) on delete set null,
  add column if not exists price_paise      int not null default 0,
  add column if not exists billing_period   text not null default 'monthly',
  add column if not exists setup_fee_paise  int not null default 0,
  add column if not exists starts_at        timestamptz,
  add column if not exists auto_pause       boolean not null default false,
  add column if not exists grace_days       int not null default 0,
  add column if not exists billing_note     text;
do $$ begin
  alter table public.restaurants
    add constraint restaurants_billing_period check (billing_period in ('monthly', 'yearly', 'one_time')),
    add constraint restaurants_billing_prices check (price_paise between 0 and 100000000 and setup_fee_paise between 0 and 100000000),
    add constraint restaurants_grace check (grace_days between 0 and 60),
    add constraint restaurants_billing_note check (billing_note is null or char_length(billing_note) <= 300);
exception when duplicate_object then null;
end $$;

-- ---------- plans ----------
create or replace function public.admin_list_plans(p_admin uuid)
returns table (id uuid, name text, points text[], setup_fee_paise int, monthly_paise int, yearly_paise int, active boolean, sort_order int, in_use bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  return query select p.id, p.name, p.points, p.setup_fee_paise, p.monthly_paise, p.yearly_paise, p.active, p.sort_order,
                      (select count(*) from public.restaurants r where r.plan_id = p.id)
                 from public.plans p order by p.sort_order, p.created_at;
end $$;

create or replace function public.admin_save_plan(p_admin uuid, p_id uuid, p_name text, p_points text[], p_setup int, p_monthly int, p_yearly int, p_active boolean, p_sort int)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := p_id; v_name text := btrim(coalesce(p_name, '')); v_points text[];
begin
  perform private.require_admin(p_admin);
  select coalesce(array_agg(btrim(x)) filter (where btrim(x) <> ''), '{}') into v_points from unnest(coalesce(p_points, '{}')) x;
  if char_length(v_name) not between 1 and 40 or coalesce(array_length(v_points, 1), 0) > 20
     or exists (select 1 from unnest(v_points) x where char_length(x) > 120)
     or p_setup is null or p_monthly is null or p_yearly is null or p_setup not between 0 and 100000000
     or p_monthly not between 0 and 100000000 or p_yearly not between 0 and 100000000 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if v_id is null then
    insert into public.plans (name, points, setup_fee_paise, monthly_paise, yearly_paise, active, sort_order)
    values (v_name, v_points, p_setup, p_monthly, p_yearly, p_active, coalesce(p_sort, 0)) returning id into v_id;
  else
    update public.plans set name = v_name, points = v_points, setup_fee_paise = p_setup, monthly_paise = p_monthly,
           yearly_paise = p_yearly, active = p_active, sort_order = coalesce(p_sort, 0) where id = v_id;
    if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
    update public.restaurants set plan = v_name where plan_id = v_id;
  end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (null, p_admin, 'platform_admin', 'plan_saved', 'plans', v_id::text, jsonb_build_object('name', v_name));
  return v_id;
exception when unique_violation then
  raise exception using errcode = 'GM019', message = 'conflict';
end $$;

create or replace function public.admin_delete_plan(p_admin uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  if exists (select 1 from public.restaurants where plan_id = p_id) then
    raise exception using errcode = 'GM019', message = 'conflict'; -- in use: switch it off instead
  end if;
  delete from public.plans where id = p_id;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (null, p_admin, 'platform_admin', 'plan_deleted', 'plans', p_id::text, '{}'::jsonb);
end $$;

-- ---------- per-restaurant plan, price and dates ----------
create or replace function public.admin_set_billing(
  p_admin uuid, p_restaurant uuid, p_plan_id uuid, p_plan_name text, p_price int, p_period text, p_setup int,
  p_starts timestamptz, p_paid_until timestamptz, p_auto_pause boolean, p_grace int, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_plan_name, ''));
begin
  perform private.require_admin(p_admin);
  if p_plan_id is not null then
    select name into v_name from public.plans where id = p_plan_id;
    if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  if char_length(v_name) not between 1 and 40 or p_price is null or p_price not between 0 and 100000000
     or p_setup is null or p_setup not between 0 and 100000000 or p_period is null or p_period not in ('monthly', 'yearly', 'one_time')
     or p_auto_pause is null or p_grace is null or p_grace not between 0 and 60 or char_length(coalesce(p_note, '')) > 300
     or (p_starts is not null and p_paid_until is not null and p_paid_until < p_starts) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.restaurants set plan_id = p_plan_id, plan = v_name, price_paise = p_price, billing_period = p_period,
         setup_fee_paise = p_setup, starts_at = p_starts, paid_until = p_paid_until, auto_pause = p_auto_pause,
         grace_days = p_grace, billing_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_restaurant;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'restaurant_plan', 'restaurants', p_restaurant::text,
          jsonb_build_object('plan', v_name, 'price_paise', p_price, 'period', p_period, 'paid_until', p_paid_until, 'auto_pause', p_auto_pause));
end $$;

drop function if exists public.admin_list_restaurants(uuid);
create or replace function public.admin_list_restaurants(p_admin uuid)
returns table (id uuid, slug text, name text, status text, plan text, paid_until timestamptz,
               created_at timestamptz, last_order_at timestamptz, order_count bigint,
               plan_id uuid, price_paise int, billing_period text, setup_fee_paise int, starts_at timestamptz,
               auto_pause boolean, grace_days int, billing_note text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  return query
    select r.id, r.slug, r.name, r.status, r.plan, r.paid_until, r.created_at,
           (select max(o.created_at) from public.orders o where o.restaurant_id = r.id),
           r.order_counter,
           r.plan_id, r.price_paise, r.billing_period, r.setup_fee_paise, r.starts_at, r.auto_pause, r.grace_days, r.billing_note
      from public.restaurants r order by r.created_at desc;
end $$;

-- ---------- names ----------
create or replace function public.admin_rename_restaurant(p_admin uuid, p_restaurant uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_admin(p_admin);
  if char_length(v_name) not between 1 and 80 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.restaurants set name = v_name where id = p_restaurant;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'restaurant_renamed', 'restaurants', p_restaurant::text, jsonb_build_object('name', v_name));
end $$;

create or replace function public.admin_set_staff_name(p_admin uuid, p_restaurant uuid, p_user uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''));
begin
  perform private.require_admin(p_admin);
  if char_length(v_name) not between 1 and 60 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.staff set display_name = v_name where user_id = p_user and restaurant_id = p_restaurant;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'staff_renamed', 'staff', p_user::text, '{}'::jsonb);
end $$;

-- ---------- duplicate ----------
-- Copies the look and the menu (categories, dishes) into a NEW restaurant with its own owner login. Tables, orders,
-- staff, QR codes, plan and dates are not copied. Photos need new storage paths: the pairs are returned so the
-- server can copy the files; anything that fails to copy is cleared again with admin_clear_images().
create or replace function public.admin_duplicate_restaurant(
  p_admin uuid, p_source uuid, p_slug text, p_name text, p_owner_user_id uuid, p_owner_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.restaurants; v_id uuid; v_images jsonb := '[]'::jsonb; c record; i record; v_cat uuid; v_path text;
  v_logo text; v_banner text;
begin
  perform private.require_admin(p_admin);
  select * into s from public.restaurants where id = p_source;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  v_id := gen_random_uuid();
  if s.logo_path is not null then v_logo := v_id::text || '/' || gen_random_uuid()::text || '.webp'; v_images := v_images || jsonb_build_array(jsonb_build_object('from', s.logo_path, 'to', v_logo)); end if;
  if s.banner_path is not null then v_banner := v_id::text || '/' || gen_random_uuid()::text || '.webp'; v_images := v_images || jsonb_build_array(jsonb_build_object('from', s.banner_path, 'to', v_banner)); end if;
  insert into public.restaurants (id, slug, name, accent, amber_minutes, red_minutes, tagline, description, logo_path, banner_path, address, hours_text)
  values (v_id, p_slug, p_name, s.accent, s.amber_minutes, s.red_minutes, s.tagline, s.description, v_logo, v_banner, s.address, s.hours_text);
  insert into public.staff (user_id, restaurant_id, role, display_name) values (p_owner_user_id, v_id, 'owner', p_owner_name);
  for c in select * from public.categories where restaurant_id = p_source order by sort_order, created_at loop
    insert into public.categories (restaurant_id, name_en, name_hi, sort_order, active)
    values (v_id, c.name_en, c.name_hi, c.sort_order, c.active) returning id into v_cat;
    for i in select * from public.items where category_id = c.id and restaurant_id = p_source order by sort_order, created_at loop
      v_path := null;
      if i.image_path is not null then
        v_path := v_id::text || '/' || gen_random_uuid()::text || '.webp';
        v_images := v_images || jsonb_build_array(jsonb_build_object('from', i.image_path, 'to', v_path));
      end if;
      insert into public.items (restaurant_id, category_id, name_en, name_hi, description_en, description_hi, price_paise, diet, spice,
                                image_path, is_available, is_bestseller, is_chef_pick, sort_order)
      values (v_id, v_cat, i.name_en, i.name_hi, i.description_en, i.description_hi, i.price_paise, i.diet, i.spice,
              v_path, i.is_available, i.is_bestseller, i.is_chef_pick, i.sort_order);
    end loop;
  end loop;
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (v_id, p_admin, 'platform_admin', 'restaurant_duplicated', 'restaurants', v_id::text, jsonb_build_object('from', s.slug, 'slug', p_slug));
  return jsonb_build_object('id', v_id, 'images', v_images);
exception when unique_violation then
  raise exception using errcode = 'GM019', message = 'conflict';
end $$;

create or replace function public.admin_clear_images(p_admin uuid, p_restaurant uuid, p_paths text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_admin(p_admin);
  update public.items set image_path = null where restaurant_id = p_restaurant and image_path = any(p_paths);
  update public.restaurants set logo_path = null where id = p_restaurant and logo_path = any(p_paths);
  update public.restaurants set banner_path = null where id = p_restaurant and banner_path = any(p_paths);
end $$;

revoke all on function public.admin_list_plans(uuid), public.admin_save_plan(uuid, uuid, text, text[], int, int, int, boolean, int),
  public.admin_delete_plan(uuid, uuid),
  public.admin_set_billing(uuid, uuid, uuid, text, int, text, int, timestamptz, timestamptz, boolean, int, text),
  public.admin_list_restaurants(uuid), public.admin_rename_restaurant(uuid, uuid, text), public.admin_set_staff_name(uuid, uuid, uuid, text),
  public.admin_duplicate_restaurant(uuid, uuid, text, text, uuid, text), public.admin_clear_images(uuid, uuid, text[])
  from public, anon, authenticated;
grant execute on function public.admin_list_plans(uuid), public.admin_save_plan(uuid, uuid, text, text[], int, int, int, boolean, int),
  public.admin_delete_plan(uuid, uuid),
  public.admin_set_billing(uuid, uuid, uuid, text, int, text, int, timestamptz, timestamptz, boolean, int, text),
  public.admin_list_restaurants(uuid), public.admin_rename_restaurant(uuid, uuid, text), public.admin_set_staff_name(uuid, uuid, uuid, text),
  public.admin_duplicate_restaurant(uuid, uuid, text, text, uuid, text), public.admin_clear_images(uuid, uuid, text[])
  to service_role;

-- ---------- expiry: the menu pauses itself when the end date (plus grace) has passed and auto_pause is on ----------
create or replace function private.plan_expired(r public.restaurants) returns boolean
language sql stable set search_path = '' as $$
  select r.auto_pause and r.paid_until is not null and r.paid_until + make_interval(days => r.grace_days) < now()
$$;
revoke all on function private.plan_expired(public.restaurants) from public, anon, authenticated;

create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick)
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;


create or replace function public.guest_check_location(p_slug text, p_lat double precision, p_lng double precision, p_acc double precision)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_dist double precision;
  a double precision;
  b double precision;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then return 'ok'; end if;
  if private.plan_expired(r) then return 'suspended'; end if;
  if not r.geo_required then return 'ok'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then return 'required'; end if;
  if p_acc is null or p_acc < 0 or p_acc > 500 then return 'inaccurate'; end if;
  a := sin(radians(p_lat - r.geo_lat) / 2) ^ 2 + cos(radians(r.geo_lat)) * cos(radians(p_lat)) * sin(radians(p_lng - r.geo_lng) / 2) ^ 2;
  v_dist := 2 * 6371000 * asin(least(1, sqrt(a)));
  -- the phone's own accuracy estimate gives the guest the benefit of the doubt, up to 200 m
  if v_dist > r.geo_radius_m + least(p_acc, 200) then return 'too_far'; end if;
  return 'ok';
end $$;

-- the owner's dashboard learns the end date rules so it can warn in time
create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role(), 'id', r.id,
            'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
            'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code,
            'auto_pause', r.auto_pause, 'grace_days', r.grace_days, 'geo_required', r.geo_required, 'geo_lat', r.geo_lat, 'geo_lng', r.geo_lng, 'geo_radius_m', r.geo_radius_m)
          from public.restaurants r where r.id = v_rid);
end $$;


-- ================= 0022_room_service.sql =================
-- 0022: room service. One shared link per restaurant; the guest types a room number before ordering.
-- Behind the scenes every room is an ordinary dining table labelled "Room 204" (kind = 'room', created the first time that
-- room orders), so live orders, status, waiter calls, bills, paying and the thank-you screen all work unchanged.
-- The shared link's token lives on the restaurant (room_token): it can open a room, but cannot place an order by itself.
-- The owner may list the valid rooms; if the list is empty any plausible room number is accepted.
-- Idempotent. Rollback: drop guest_open_room / mgr_get_room_service / mgr_set_room_service, the two columns below and the
-- kind column; restore guest_get_menu from 0021, mgr_get_table_tokens from 0006, mgr_create_tables from 0006.

alter table public.dining_tables add column if not exists kind text not null default 'table';
alter table public.restaurants
  add column if not exists room_token   text,
  add column if not exists room_numbers text[] not null default '{}';
do $$ begin
  alter table public.dining_tables add constraint dining_tables_kind check (kind in ('table', 'room'));
exception when duplicate_object then null;
end $$;
do $$ begin
  alter table public.restaurants
    add constraint restaurants_room_token_format check (room_token is null or room_token ~ '^[0-9a-f]{64}$'),
    add constraint restaurants_room_numbers_len check (coalesce(array_length(room_numbers, 1), 0) <= 300);
exception when duplicate_object then null;
end $$;
create unique index if not exists restaurants_room_token_uq on public.restaurants (room_token) where room_token is not null;

-- ---------- tables page: rooms stay out of the table list and the QR print-outs ----------
create or replace function public.mgr_get_table_tokens()
returns table (table_id uuid, label text, active boolean, qr_token text)
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid;
begin
  v_rid := private.require_staff(array['owner','manager']);
  return query select t.id, t.label, t.active, t.qr_token from public.dining_tables t
               where t.restaurant_id = v_rid and t.kind = 'table' order by t.created_at, t.label;
end $$;

create or replace function public.mgr_create_tables(p_from int, p_to int) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; v_n int;
begin
  v_rid := private.require_staff(array['owner','manager']);
  if p_from is null or p_to is null or p_from < 1 or p_to < p_from or p_to - p_from >= 200 or p_to > 999 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.dining_tables where restaurant_id = v_rid and kind = 'table') + (p_to - p_from + 1) > 400 then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  insert into public.dining_tables (restaurant_id, label)
  select v_rid, g::text from generate_series(p_from, p_to) g
  on conflict (restaurant_id, label) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------- owner / manager: the room-service link ----------
create or replace function public.mgr_get_room_service() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); r public.restaurants;
begin
  select * into r from public.restaurants where id = v_rid;
  return jsonb_build_object('enabled', r.room_token is not null, 'token', r.room_token, 'rooms', to_jsonb(r.room_numbers));
end $$;

-- p_enabled false switches the link off (its token is erased, so the old link stops working); p_rotate makes a new token.
create or replace function public.mgr_set_room_service(p_enabled boolean, p_rooms text[], p_rotate boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner']);
  v_rooms text[];
  r public.restaurants;
begin
  if p_enabled is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  -- normalise: upper case, single spaces, letters/digits/space/hyphen, 1-10 characters, no duplicates
  select coalesce(array_agg(x order by x), '{}') into v_rooms from (
    select distinct upper(regexp_replace(btrim(e), '\s+', ' ', 'g')) as x from unnest(coalesce(p_rooms, '{}')) e) q where x <> '';
  if exists (select 1 from unnest(v_rooms) x where x !~ '^[A-Z0-9][A-Z0-9 -]{0,9}$') or coalesce(array_length(v_rooms, 1), 0) > 300 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into r from public.restaurants where id = v_rid for update;
  update public.restaurants
     set room_numbers = v_rooms,
         room_token = case when not p_enabled then null
                           when r.room_token is null or coalesce(p_rotate, false)
                             then replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
                           else r.room_token end
   where id = v_rid;
  perform private.write_audit(v_rid, 'room_service_updated', 'restaurants', v_rid::text,
    jsonb_build_object('enabled', p_enabled, 'rooms', coalesce(array_length(v_rooms, 1), 0), 'rotated', coalesce(p_rotate, false)));
end $$;

revoke all on function public.mgr_get_room_service(), public.mgr_set_room_service(boolean, text[], boolean) from public, anon, service_role;
grant execute on function public.mgr_get_room_service(), public.mgr_set_room_service(boolean, text[], boolean) to authenticated;

-- ---------- guest: pick a room, get that room's own table token ----------
-- Service role only (called by /api/guest/room). Returns the room's normal table token; from then on the guest page behaves
-- exactly like a table QR scan. Throttled per address; at most 500 rooms per restaurant can ever be created on demand.
create or replace function public.guest_open_room(p_slug text, p_token text, p_room text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_room text := upper(regexp_replace(btrim(coalesce(p_room, '')), '\s+', ' ', 'g'));
  t public.dining_tables;
begin
  if p_slug is null or p_token is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_ip_hash is not null and not private.rl_hit('room:' || p_ip_hash, 40, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;
  select * into r from public.restaurants where slug = p_slug and room_token = p_token;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  if v_room !~ '^[A-Z0-9][A-Z0-9 -]{0,9}$' then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if coalesce(array_length(r.room_numbers, 1), 0) > 0 and not (v_room = any (r.room_numbers)) then
    raise exception using errcode = 'GM022', message = 'unknown_room';
  end if;

  select * into t from public.dining_tables where restaurant_id = r.id and label = 'Room ' || v_room;
  if not found then
    if (select count(*) from public.dining_tables where restaurant_id = r.id and kind = 'room') >= 500 then
      raise exception using errcode = 'GM006', message = 'limit_exceeded';
    end if;
    insert into public.dining_tables (restaurant_id, label, kind) values (r.id, 'Room ' || v_room, 'room')
    on conflict (restaurant_id, label) do nothing;
    select * into t from public.dining_tables where restaurant_id = r.id and label = 'Room ' || v_room;
  end if;
  if not t.active then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;
  return jsonb_build_object('token', t.qr_token, 'label', t.label);
end $$;
revoke all on function public.guest_open_room(text, text, text, text) from public, anon, authenticated;
grant execute on function public.guest_open_room(text, text, text, text) to service_role;

-- ---------- guest menu: tell the page when the link is the shared room-service link ----------
create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
  v_room_link boolean;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  v_room_link := p_token is not null and r.room_token is not null and r.room_token = p_token;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'room_link', v_room_link,
    'rooms', case when v_room_link then to_jsonb(r.room_numbers) else null end,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick)
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;

-- ================= 0023_table_link.sql =================
-- 0023: a shared TABLE link (the guest picks a table number), next to the per-table QR codes and the room-service link.
-- Three ways to order, the owner uses whichever fit: (1) each table's own QR (0002), (2) one shared table link (this file),
-- (3) one shared room link (0022). Table picking only ever opens real tables the owner created (kind 'table'); room picking
-- only ever opens rooms (kind 'room'), so neither link can show or reach the other kind.
-- Like the room link, the shared token can only OPEN a table; it cannot place an order itself.
-- Idempotent. Rollback: drop guest_open_table / mgr_get_table_link / mgr_set_table_link and the table_token column;
-- restore guest_get_menu from 0022.

alter table public.restaurants add column if not exists table_token text;
do $$ begin
  alter table public.restaurants add constraint restaurants_table_token_format check (table_token is null or table_token ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;
create unique index if not exists restaurants_table_token_uq on public.restaurants (table_token) where table_token is not null;

create or replace function public.mgr_get_table_link() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); r public.restaurants;
begin
  select * into r from public.restaurants where id = v_rid;
  return jsonb_build_object('enabled', r.table_token is not null, 'token', r.table_token);
end $$;

-- p_enabled false switches the link off (token erased, old link stops); p_rotate makes a new token.
create or replace function public.mgr_set_table_link(p_enabled boolean, p_rotate boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']); r public.restaurants;
begin
  if p_enabled is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into r from public.restaurants where id = v_rid for update;
  update public.restaurants
     set table_token = case when not p_enabled then null
                            when r.table_token is null or coalesce(p_rotate, false)
                              then replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
                            else r.table_token end
   where id = v_rid;
  perform private.write_audit(v_rid, 'table_link_updated', 'restaurants', v_rid::text,
    jsonb_build_object('enabled', p_enabled, 'rotated', coalesce(p_rotate, false)));
end $$;
revoke all on function public.mgr_get_table_link(), public.mgr_set_table_link(boolean, boolean) from public, anon, service_role;
grant execute on function public.mgr_get_table_link(), public.mgr_set_table_link(boolean, boolean) to authenticated;

-- Service role only (called by /api/guest/table). The table must already exist (the owner created it) and be on.
create or replace function public.guest_open_table(p_slug text, p_token text, p_label text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_label text := btrim(coalesce(p_label, ''));
  t public.dining_tables;
begin
  if p_slug is null or p_token is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_ip_hash is not null and not private.rl_hit('tbl:' || p_ip_hash, 40, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;
  select * into r from public.restaurants where slug = p_slug and table_token = p_token;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  if char_length(v_label) not between 1 and 20 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into t from public.dining_tables
   where restaurant_id = r.id and kind = 'table' and active and lower(label) = lower(v_label);
  if not found then
    raise exception using errcode = 'GM022', message = 'unknown_room';  -- "that number is not on the list"
  end if;
  return jsonb_build_object('token', t.qr_token, 'label', t.label);
end $$;
revoke all on function public.guest_open_table(text, text, text, text) from public, anon, authenticated;
grant execute on function public.guest_open_table(text, text, text, text) to service_role;

-- guest menu: also tell the page when the link is the shared table link, with the table names to choose from
create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
  v_room_link boolean;
  v_table_link boolean;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  v_room_link := p_token is not null and r.room_token is not null and r.room_token = p_token;
  v_table_link := p_token is not null and r.table_token is not null and r.table_token = p_token;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'room_link', v_room_link,
    'rooms', case when v_room_link then to_jsonb(r.room_numbers) else null end,
    'table_link', v_table_link,
    'tables', case when v_table_link then coalesce((
        select jsonb_agg(d.label order by length(d.label), d.label)
          from public.dining_tables d where d.restaurant_id = r.id and d.kind = 'table' and d.active), '[]'::jsonb) else null end,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick)
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;

-- ================= 0024_item_sizes_options.sql =================
-- 0024: dish sizes and options.
--   Sizes (item_variants): Small / Medium / Large / XL, or Half / Full, each with its OWN price. A dish with sizes is
--     ordered by choosing one size (the guest taps the dish and picks). The dish's own price is kept equal to the cheapest
--     size so lists, reports and "from Rs" labels keep working.
--   Options (item_option_groups + item_options): extra choices such as "Choose your sauce" (pick 1, required) or
--     "Add extras" (pick up to 3, optional), each choice with an extra price (0 allowed).
-- Prices are always computed here, never taken from the browser. The order line keeps a readable snapshot in
-- order_items.name_en_snapshot, e.g. "Oreo Shake (Large) + Extra Oreo, Choco chips", so staff screens, bills and
-- reports show it without any other change. Idempotent. Rollback: restore guest_place_order from 0005, guest_get_menu
-- from 0023, mgr_get_menu / mgr_duplicate_item / mgr_bulk_price / mgr_import_items from 0013, then drop the three tables.

-- ---------- tables ----------
create table if not exists public.item_variants (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id       uuid not null,
  name          text not null,
  price_paise   int not null,
  is_available  boolean not null default true,
  sort_order    int not null default 0,
  constraint item_variants_item_fk foreign key (item_id, restaurant_id) references public.items (id, restaurant_id) on delete cascade,
  constraint item_variants_name check (char_length(name) between 1 and 30),
  constraint item_variants_price check (price_paise between 0 and 10000000)
);
create unique index if not exists item_variants_name_uq on public.item_variants (item_id, lower(name));
create index if not exists item_variants_item_idx on public.item_variants (item_id);

create table if not exists public.item_option_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id       uuid not null,
  name          text not null,
  required      boolean not null default false,
  max_select    int not null default 1,
  sort_order    int not null default 0,
  constraint item_option_groups_item_fk foreign key (item_id, restaurant_id) references public.items (id, restaurant_id) on delete cascade,
  constraint item_option_groups_id_restaurant_uq unique (id, restaurant_id),
  constraint item_option_groups_name check (char_length(name) between 1 and 40),
  constraint item_option_groups_max check (max_select between 1 and 20)
);
create index if not exists item_option_groups_item_idx on public.item_option_groups (item_id);

create table if not exists public.item_options (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  group_id          uuid not null,
  name              text not null,
  price_delta_paise int not null default 0,
  sort_order        int not null default 0,
  constraint item_options_group_fk foreign key (group_id, restaurant_id) references public.item_option_groups (id, restaurant_id) on delete cascade,
  constraint item_options_name check (char_length(name) between 1 and 40),
  constraint item_options_price check (price_delta_paise between 0 and 5000000)
);
create index if not exists item_options_group_idx on public.item_options (group_id);

-- Like every table: row level security on, no direct access for anyone; the functions below are the only way in.
alter table public.item_variants      enable row level security;
alter table public.item_option_groups enable row level security;
alter table public.item_options       enable row level security;
revoke all on public.item_variants, public.item_option_groups, public.item_options from public, anon, authenticated;

-- order lines may carry the longer readable name
alter table public.order_items drop constraint if exists order_items_name_len;
alter table public.order_items add constraint order_items_name_len check (char_length(name_en_snapshot) between 1 and 200);

-- A dish with sizes always carries its cheapest size as its own price (also when saved, bulk-changed or imported).
create or replace function private.items_keep_size_price() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_min int;
begin
  select min(price_paise) into v_min from public.item_variants where item_id = new.id;
  if v_min is not null then new.price_paise := v_min; end if;
  return new;
end $$;
revoke all on function private.items_keep_size_price() from public, anon, authenticated;
drop trigger if exists items_keep_size_price on public.items;
create trigger items_keep_size_price before update of price_paise on public.items
  for each row execute function private.items_keep_size_price();

-- ---------- guest: the menu now lists sizes and options ----------
create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
  v_room_link boolean;
  v_table_link boolean;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  v_room_link := p_token is not null and r.room_token is not null and r.room_token = p_token;
  v_table_link := p_token is not null and r.table_token is not null and r.table_token = p_token;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'room_link', v_room_link,
    'rooms', case when v_room_link then to_jsonb(r.room_numbers) else null end,
    'table_link', v_table_link,
    'tables', case when v_table_link then coalesce((
        select jsonb_agg(d.label order by length(d.label), d.label)
          from public.dining_tables d where d.restaurant_id = r.id and d.kind = 'table' and d.active), '[]'::jsonb) else null end,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick,
            'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_paise', v.price_paise, 'is_available', v.is_available)
                                  order by v.sort_order, v.price_paise)
                                    from public.item_variants v where v.item_id = i.id), '[]'::jsonb),
            'option_groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'required', g.required, 'max_select', g.max_select,
                                         'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_delta_paise', o.price_delta_paise)
                                                               order by o.sort_order, o.name)
                                                                 from public.item_options o where o.group_id = g.id), '[]'::jsonb))
                                       order by g.sort_order, g.name)
                                         from public.item_option_groups g where g.item_id = i.id), '[]'::jsonb))
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;

-- ---------- guest: place an order (lines may carry variant_id and option_ids) ----------
create or replace function public.guest_place_order(
  p_slug text, p_token text, p_items jsonb, p_note text, p_idem text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_max_lines   constant int := 25;
  c_max_qty     constant int := 10;
  c_max_total   constant bigint := 1500000;   -- Rs 15,000 in paise
  c_max_pending constant int := 3;
  c_max_per_10m constant int := 8;
  c_ip_limit    constant int := 60;
  t public.dining_tables;
  r public.restaurants;
  s public.table_sessions;
  o public.orders;
  i public.items;
  v public.item_variants;
  l record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_total bigint := 0;
  v_lines int;
  v_order_no bigint;
  v_calc jsonb := '[]'::jsonb;
  v_unit bigint;
  v_name text;
  v_delta bigint;
  v_opt_names text;
  v_n int;
begin
  if p_ip_hash is not null and not private.rl_hit('ip:' || p_ip_hash, c_ip_limit, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  if p_slug is null or p_token is null or p_idem is null or char_length(p_idem) not between 8 and 64
     or (v_note is not null and char_length(v_note) > 200)
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  v_lines := jsonb_array_length(p_items);
  if v_lines > c_max_lines then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  begin
    perform 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]);
  exception when others then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[])
             where x.item_id is null or x.qty is null or x.qty < 1 or char_length(coalesce(x.note, '')) > 100
                or coalesce(cardinality(x.option_ids), 0) > 20
                or coalesce(cardinality(x.option_ids), 0) <> (select count(distinct oo) from unnest(coalesce(x.option_ids, '{}')) oo)) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]) where x.qty > c_max_qty) then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  -- the same dish may appear twice only with a different size or different options
  if (select count(distinct x.item_id::text || '|' || coalesce(x.variant_id::text, '') || '|' ||
                     coalesce((select string_agg(oo::text, ',' order by oo::text) from unnest(x.option_ids) oo), ''))
        from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[])) <> v_lines then
    raise exception using errcode = 'GM005', message = 'duplicate_item';
  end if;

  select t2.* into t
    from public.dining_tables t2 join public.restaurants r2 on r2.id = t2.restaurant_id
   where t2.qr_token = p_token and r2.slug = p_slug and t2.active;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;

  select * into r from public.restaurants where id = t.restaurant_id for no key update;
  if r.status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;

  select * into o from public.orders
   where table_id = t.id and idempotency_key = p_idem and created_at > now() - interval '1 hour'
   limit 1;
  if found then
    return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'total_paise', o.total_paise,
      'session_id', o.session_id, 'table_label', t.label, 'status', o.status, 'replayed', true);
  end if;

  select * into s from public.table_sessions where table_id = t.id and closed_at is null for update;
  if not found then
    insert into public.table_sessions (restaurant_id, table_id) values (r.id, t.id) returning * into s;
  end if;

  if (select count(*) from public.orders where session_id = s.id and status = 'placed') >= c_max_pending then
    raise exception using errcode = 'GM008', message = 'too_many_pending';
  end if;
  if (select count(*) from public.orders where table_id = t.id and created_at > now() - interval '10 minutes') >= c_max_per_10m then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  -- lock the rows prices come from (stable order) so nothing can change before we commit
  perform 1 from public.items it
   where it.restaurant_id = r.id
     and it.id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]))
   order by it.id for share;
  perform 1 from public.item_variants iv
   where iv.restaurant_id = r.id
     and iv.item_id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]))
   order by iv.id for share;
  perform 1 from public.item_options io join public.item_option_groups ig on ig.id = io.group_id
   where io.restaurant_id = r.id
     and ig.item_id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]))
   order by io.id for share of io;

  -- price every line from the database
  for l in select (e.j->>'item_id')::uuid as item_id, (e.j->>'qty')::int as qty, e.j->>'note' as note,
                  nullif(e.j->>'variant_id', '')::uuid as variant_id,
                  case when jsonb_typeof(e.j->'option_ids') = 'array' then array(select jsonb_array_elements_text(e.j->'option_ids'))::uuid[] else '{}'::uuid[] end as option_ids
             from jsonb_array_elements(p_items) with ordinality e(j, ord)
            order by e.ord loop
    select * into i from public.items where id = l.item_id and restaurant_id = r.id;
    if not found then
      raise exception using errcode = 'GM004', message = 'item_not_found';
    end if;
    if not i.is_available or not exists (select 1 from public.categories c where c.id = i.category_id and c.restaurant_id = r.id and c.active) then
      raise exception using errcode = 'GM003', message = 'item_unavailable';
    end if;

    v := null;
    if exists (select 1 from public.item_variants iv where iv.item_id = i.id) then
      if l.variant_id is null then
        raise exception using errcode = 'GM015', message = 'invalid_input';   -- a size must be chosen
      end if;
      select * into v from public.item_variants iv where iv.id = l.variant_id and iv.item_id = i.id;
      if not found then
        raise exception using errcode = 'GM004', message = 'item_not_found';   -- that size was removed
      end if;
      if not v.is_available then
        raise exception using errcode = 'GM003', message = 'item_unavailable';
      end if;
      v_unit := v.price_paise;
    else
      if l.variant_id is not null then
        raise exception using errcode = 'GM015', message = 'invalid_input';
      end if;
      v_unit := i.price_paise;
    end if;

    v_delta := 0;
    v_opt_names := null;
    if cardinality(l.option_ids) > 0 then
      select count(*), coalesce(sum(io.price_delta_paise), 0),
             string_agg(io.name, ', ' order by ig.sort_order, io.sort_order, io.name)
        into v_n, v_delta, v_opt_names
        from public.item_options io join public.item_option_groups ig on ig.id = io.group_id
       where io.id = any (l.option_ids) and ig.item_id = i.id and ig.restaurant_id = r.id;
      if v_n <> cardinality(l.option_ids) then
        raise exception using errcode = 'GM004', message = 'item_not_found';   -- an option was removed
      end if;
      if exists (select 1 from public.item_option_groups ig
                  where ig.item_id = i.id
                    and (select count(*) from public.item_options io where io.group_id = ig.id and io.id = any (l.option_ids)) > ig.max_select) then
        raise exception using errcode = 'GM015', message = 'invalid_input';
      end if;
    end if;
    if exists (select 1 from public.item_option_groups ig
                where ig.item_id = i.id and ig.required
                  and not exists (select 1 from public.item_options io where io.group_id = ig.id and io.id = any (l.option_ids))) then
      raise exception using errcode = 'GM015', message = 'invalid_input';       -- a required choice is missing
    end if;

    v_unit := v_unit + v_delta;
    v_name := left(i.name_en || case when v.id is not null then ' (' || v.name || ')' else '' end
                   || case when v_opt_names is not null then ' + ' || v_opt_names else '' end, 200);
    v_total := v_total + v_unit * l.qty;
    v_calc := v_calc || jsonb_build_object('item_id', i.id, 'name', v_name, 'name_hi', i.name_hi, 'unit', v_unit, 'qty', l.qty,
                                           'note', nullif(btrim(coalesce(l.note, '')), ''));
  end loop;
  if v_total > c_max_total then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;

  update public.restaurants set order_counter = order_counter + 1 where id = r.id returning order_counter into v_order_no;

  insert into public.orders (restaurant_id, session_id, table_id, order_no, note, total_paise, idempotency_key)
  values (r.id, s.id, t.id, v_order_no, v_note, v_total, p_idem)
  returning * into o;

  insert into public.order_items (order_id, restaurant_id, item_id, name_en_snapshot, name_hi_snapshot, unit_price_paise, qty, note)
  select o.id, r.id, (c.j->>'item_id')::uuid, c.j->>'name', c.j->>'name_hi', (c.j->>'unit')::int, (c.j->>'qty')::int, c.j->>'note'
    from jsonb_array_elements(v_calc) with ordinality c(j, ord)
   order by c.ord;

  return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'total_paise', o.total_paise,
    'session_id', s.id, 'table_label', t.label, 'status', o.status, 'replayed', false);
end $$;

-- ---------- owner / manager: the dish editor ----------
create or replace function public.mgr_get_menu() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return jsonb_build_object('categories', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name_en, 'active', c.active, 'sort_order', c.sort_order,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'name', i.name_en, 'description', i.description_en, 'price_paise', i.price_paise, 'diet', i.diet,
          'spice', i.spice, 'image_path', i.image_path, 'is_available', i.is_available, 'is_bestseller', i.is_bestseller,
          'is_chef_pick', i.is_chef_pick, 'sort_order', i.sort_order,
          'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_paise', v.price_paise, 'is_available', v.is_available)
                                order by v.sort_order, v.price_paise)
                                  from public.item_variants v where v.item_id = i.id), '[]'::jsonb),
          'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'required', g.required, 'max_select', g.max_select,
                                'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_delta_paise', o.price_delta_paise)
                                                      order by o.sort_order, o.name)
                                                        from public.item_options o where o.group_id = g.id), '[]'::jsonb))
                              order by g.sort_order, g.name)
                                from public.item_option_groups g where g.item_id = i.id), '[]'::jsonb))
          order by i.sort_order, i.name_en)
        from public.items i where i.category_id = c.id and i.restaurant_id = v_rid), '[]'::jsonb))
      order by c.sort_order, c.name_en)
    from public.categories c where c.restaurant_id = v_rid), '[]'::jsonb));
end $$;

-- Replace a dish's sizes and options in one go. Rows with an id are updated, rows without are created, rows left out are
-- removed (past orders keep their own readable snapshot, so nothing in order history changes).
--   p_variants: [{id?, name, price_paise, is_available?}]            at most 8
--   p_groups:   [{id?, name, required, max_select, options:[{id?, name, price_delta_paise}]}]   at most 6 groups, 20 options each
create or replace function public.mgr_save_item_choices(p_item_id uuid, p_variants jsonb, p_groups jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner','manager']);
  v_variants jsonb := coalesce(p_variants, '[]'::jsonb);
  v_groups jsonb := coalesce(p_groups, '[]'::jsonb);
  e record; o record;
  v_id uuid; v_gid uuid; v_name text; v_price numeric; v_max numeric; v_ids uuid[];
begin
  if not exists (select 1 from public.items where id = p_item_id and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if jsonb_typeof(v_variants) <> 'array' or jsonb_typeof(v_groups) <> 'array'
     or jsonb_array_length(v_variants) > 8 or jsonb_array_length(v_groups) > 6 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  -- validate everything first
  for e in select x.value j from jsonb_array_elements(v_variants) x loop
    v_name := btrim(coalesce(e.j->>'name', ''));
    begin v_price := (e.j->>'price_paise')::numeric; exception when others then v_price := null; end;
    if jsonb_typeof(e.j) <> 'object' or char_length(v_name) not between 1 and 30
       or v_price is null or v_price <> trunc(v_price) or v_price not between 0 and 10000000 then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
  end loop;
  if (select count(distinct lower(btrim(x.value->>'name'))) from jsonb_array_elements(v_variants) x) <> jsonb_array_length(v_variants) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  for e in select x.value j from jsonb_array_elements(v_groups) x loop
    v_name := btrim(coalesce(e.j->>'name', ''));
    begin v_max := (e.j->>'max_select')::numeric; exception when others then v_max := null; end;
    if jsonb_typeof(e.j) <> 'object' or char_length(v_name) not between 1 and 40
       or v_max is null or v_max <> trunc(v_max) or v_max not between 1 and 20
       or jsonb_typeof(e.j->'options') is distinct from 'array'
       or jsonb_typeof(e.j->'required') is distinct from 'boolean' then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
    if jsonb_array_length(e.j->'options') not between 1 and 20 or v_max > jsonb_array_length(e.j->'options') then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
    for o in select y.value j from jsonb_array_elements(e.j->'options') y loop
      begin v_price := coalesce((o.j->>'price_delta_paise')::numeric, 0); exception when others then v_price := null; end;
      if jsonb_typeof(o.j) <> 'object' or char_length(btrim(coalesce(o.j->>'name', ''))) not between 1 and 40
         or v_price is null or v_price <> trunc(v_price) or v_price not between 0 and 5000000 then
        raise exception using errcode = 'GM015', message = 'invalid_input';
      end if;
    end loop;
  end loop;
  if (select count(distinct lower(btrim(x.value->>'name'))) from jsonb_array_elements(v_groups) x) <> jsonb_array_length(v_groups) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  -- sizes
  select coalesce(array_agg((x.value->>'id')::uuid), '{}') into v_ids from jsonb_array_elements(v_variants) x where nullif(x.value->>'id', '') is not null;
  delete from public.item_variants where item_id = p_item_id and restaurant_id = v_rid and id <> all (v_ids);
  -- names are unique per dish: park the kept rows under temporary names first so a swap (A<->B) cannot collide
  update public.item_variants set name = '~' || substr(md5(id::text), 1, 12) where item_id = p_item_id and restaurant_id = v_rid;
  for e in select x.value j, x.ordinality n from jsonb_array_elements(v_variants) with ordinality x loop
    v_id := nullif(e.j->>'id', '')::uuid;
    if v_id is not null then
      update public.item_variants
         set name = btrim(e.j->>'name'), price_paise = (e.j->>'price_paise')::int,
             is_available = coalesce((e.j->>'is_available')::boolean, true), sort_order = e.n
       where id = v_id and item_id = p_item_id and restaurant_id = v_rid;
      if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
    else
      insert into public.item_variants (restaurant_id, item_id, name, price_paise, is_available, sort_order)
      values (v_rid, p_item_id, btrim(e.j->>'name'), (e.j->>'price_paise')::int, coalesce((e.j->>'is_available')::boolean, true), e.n);
    end if;
  end loop;
  update public.items set price_paise = price_paise where id = p_item_id;   -- the trigger sets the cheapest size

  -- options
  select coalesce(array_agg((x.value->>'id')::uuid), '{}') into v_ids from jsonb_array_elements(v_groups) x where nullif(x.value->>'id', '') is not null;
  delete from public.item_option_groups where item_id = p_item_id and restaurant_id = v_rid and id <> all (v_ids);
  for e in select x.value j, x.ordinality n from jsonb_array_elements(v_groups) with ordinality x loop
    v_gid := nullif(e.j->>'id', '')::uuid;
    if v_gid is not null then
      update public.item_option_groups
         set name = btrim(e.j->>'name'), required = (e.j->>'required')::boolean, max_select = (e.j->>'max_select')::int, sort_order = e.n
       where id = v_gid and item_id = p_item_id and restaurant_id = v_rid;
      if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
    else
      insert into public.item_option_groups (restaurant_id, item_id, name, required, max_select, sort_order)
      values (v_rid, p_item_id, btrim(e.j->>'name'), (e.j->>'required')::boolean, (e.j->>'max_select')::int, e.n)
      returning id into v_gid;
    end if;
    select coalesce(array_agg((y.value->>'id')::uuid), '{}') into v_ids from jsonb_array_elements(e.j->'options') y where nullif(y.value->>'id', '') is not null;
    delete from public.item_options where group_id = v_gid and restaurant_id = v_rid and id <> all (v_ids);
    for o in select y.value j, y.ordinality n from jsonb_array_elements(e.j->'options') with ordinality y loop
      v_id := nullif(o.j->>'id', '')::uuid;
      if v_id is not null then
        update public.item_options
           set name = btrim(o.j->>'name'), price_delta_paise = coalesce((o.j->>'price_delta_paise')::int, 0), sort_order = o.n
         where id = v_id and group_id = v_gid and restaurant_id = v_rid;
        if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
      else
        insert into public.item_options (restaurant_id, group_id, name, price_delta_paise, sort_order)
        values (v_rid, v_gid, btrim(o.j->>'name'), coalesce((o.j->>'price_delta_paise')::int, 0), o.n);
      end if;
    end loop;
  end loop;

  perform private.write_audit(v_rid, 'item_choices_saved', 'items', p_item_id::text,
    jsonb_build_object('sizes', jsonb_array_length(v_variants), 'option_groups', jsonb_array_length(v_groups)));
end $$;

-- a copy of a dish keeps its sizes and options
create or replace function public.mgr_duplicate_item(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); i public.items; v_name text; n int := 1; v_new uuid; g record; v_g uuid;
begin
  select * into i from public.items where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  v_name := left(i.name_en, 71) || ' (copy)';
  while exists (select 1 from public.items where category_id = i.category_id and lower(name_en) = lower(v_name)) loop
    n := n + 1;
    v_name := left(i.name_en, 68) || ' (copy ' || n || ')';
  end loop;
  insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice, image_path,
                            is_bestseller, is_chef_pick, is_available, sort_order)
  values (v_rid, i.category_id, v_name, i.description_en, i.price_paise, i.diet, i.spice, i.image_path, i.is_bestseller,
          i.is_chef_pick, i.is_available, coalesce((select max(sort_order) + 1 from public.items where category_id = i.category_id), 0))
  returning id into v_new;
  insert into public.item_variants (restaurant_id, item_id, name, price_paise, is_available, sort_order)
    select restaurant_id, v_new, name, price_paise, is_available, sort_order from public.item_variants where item_id = p_id;
  for g in select * from public.item_option_groups where item_id = p_id order by sort_order loop
    insert into public.item_option_groups (restaurant_id, item_id, name, required, max_select, sort_order)
    values (v_rid, v_new, g.name, g.required, g.max_select, g.sort_order) returning id into v_g;
    insert into public.item_options (restaurant_id, group_id, name, price_delta_paise, sort_order)
      select restaurant_id, v_g, name, price_delta_paise, sort_order from public.item_options where group_id = g.id;
  end loop;
  return v_new;
end $$;

-- Bulk price change also moves every size price (add Rs 10 to all selected dishes = Rs 10 on each size).
create or replace function public.mgr_bulk_price(p_item_ids uuid[], p_mode text, p_value numeric) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); n int;
begin
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 300 or p_mode not in ('percent','add','set') or p_value is null
     or abs(p_value) > 100000000 or (p_mode = 'percent' and p_value < -100) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.items where restaurant_id = v_rid and id = any (p_item_ids)) <> (select count(distinct x) from unnest(p_item_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (
       select 1 from public.items i where i.restaurant_id = v_rid and i.id = any (p_item_ids)
          and (case p_mode when 'percent' then round(i.price_paise * (1 + p_value / 100.0)) when 'add' then i.price_paise + p_value else p_value end)
              not between 0 and 10000000)
     or exists (
       select 1 from public.item_variants v where v.restaurant_id = v_rid and v.item_id = any (p_item_ids)
          and (case p_mode when 'percent' then round(v.price_paise * (1 + p_value / 100.0)) when 'add' then v.price_paise + p_value else p_value end)
              not between 0 and 10000000) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.item_variants v set price_paise = (case p_mode when 'percent' then round(v.price_paise * (1 + p_value / 100.0)) when 'add' then v.price_paise + p_value else p_value end)::int
   where v.restaurant_id = v_rid and v.item_id = any (p_item_ids);
  update public.items i set price_paise = (case p_mode when 'percent' then round(i.price_paise * (1 + p_value / 100.0)) when 'add' then i.price_paise + p_value else p_value end)::int
   where i.restaurant_id = v_rid and i.id = any (p_item_ids);   -- the trigger keeps dishes with sizes at their cheapest size
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mgr_get_menu(), public.mgr_save_item_choices(uuid, jsonb, jsonb), public.mgr_duplicate_item(uuid),
  public.mgr_bulk_price(uuid[], text, numeric) from public, anon, service_role;
grant execute on function public.mgr_get_menu(), public.mgr_save_item_choices(uuid, jsonb, jsonb), public.mgr_duplicate_item(uuid),
  public.mgr_bulk_price(uuid[], text, numeric) to authenticated;

-- CSV import: an optional `sizes` list per dish ({name, price_paise}); see src/lib/dash/csv.ts
create or replace function public.mgr_import_items(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner','manager']);
  r record; v_errors jsonb := '[]'::jsonb; v_created int := 0; v_updated int := 0; v_cats int := 0;
  v_cat uuid; v_exists uuid; v_seen text[] := '{}'; v_key text; v_price numeric; v_item uuid; sz record;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  for r in select e.value as j, e.ordinality as n from jsonb_array_elements(p_rows) with ordinality e loop
    begin
      v_price := (r.j->>'price_paise')::numeric;
      v_key := lower(btrim(r.j->>'category')) || '|' || lower(btrim(r.j->>'name'));
      if char_length(btrim(coalesce(r.j->>'category', ''))) not between 1 and 60 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Category must be 1 to 60 characters');
      elsif char_length(btrim(coalesce(r.j->>'name', ''))) not between 1 and 80 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Name must be 1 to 80 characters');
      elsif v_price is null or v_price <> trunc(v_price) or v_price not between 0 and 10000000 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Price must be between 0 and 1,00,000 rupees');
      elsif coalesce(r.j->>'diet', '') not in ('veg','nonveg','egg','jain') then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Diet must be veg, nonveg, egg or jain');
      elsif coalesce((r.j->>'spice')::int, -1) not between 0 and 3 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Spice must be 0, 1, 2 or 3');
      elsif char_length(coalesce(r.j->>'description', '')) > 300 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Description is longer than 300 characters');
      elsif r.j ? 'sizes' and (
              jsonb_typeof(r.j->'sizes') <> 'array' or jsonb_array_length(r.j->'sizes') > 8
              or exists (select 1 from jsonb_array_elements(r.j->'sizes') z
                          where char_length(btrim(coalesce(z.value->>'name', ''))) not between 1 and 30
                             or (z.value->>'price_paise') is null
                             or (z.value->>'price_paise')::numeric not between 0 and 10000000
                             or (z.value->>'price_paise')::numeric <> trunc((z.value->>'price_paise')::numeric))
              or (select count(distinct lower(btrim(z.value->>'name'))) from jsonb_array_elements(r.j->'sizes') z) <> jsonb_array_length(r.j->'sizes')) then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Sizes: up to 8, each like Small:120, with no name repeated');
      elsif v_key = any (v_seen) then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'This dish appears twice in the file');
      end if;
      v_seen := v_seen || v_key;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'This row could not be read');
    end;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  for r in select e.value as j from jsonb_array_elements(p_rows) with ordinality e order by e.ordinality loop
    select id into v_cat from public.categories where restaurant_id = v_rid and lower(name_en) = lower(btrim(r.j->>'category'));
    if v_cat is null then
      insert into public.categories (restaurant_id, name_en, sort_order)
      values (v_rid, btrim(r.j->>'category'), coalesce((select max(sort_order) + 1 from public.categories where restaurant_id = v_rid), 0))
      returning id into v_cat;
      v_cats := v_cats + 1;
    end if;
    select id into v_exists from public.items where category_id = v_cat and lower(name_en) = lower(btrim(r.j->>'name'));
    if v_exists is null then
      insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice, is_bestseller,
                                is_chef_pick, is_available, sort_order)
      values (v_rid, v_cat, btrim(r.j->>'name'), nullif(btrim(coalesce(r.j->>'description', '')), ''), (r.j->>'price_paise')::int,
              r.j->>'diet', (r.j->>'spice')::int, coalesce((r.j->>'bestseller')::boolean, false), coalesce((r.j->>'chef_pick')::boolean, false),
              coalesce((r.j->>'available')::boolean, true),
              coalesce((select max(sort_order) + 1 from public.items where category_id = v_cat), 0));
      v_created := v_created + 1;
    else
      update public.items set description_en = nullif(btrim(coalesce(r.j->>'description', '')), ''), price_paise = (r.j->>'price_paise')::int,
             diet = r.j->>'diet', spice = (r.j->>'spice')::int, is_bestseller = coalesce((r.j->>'bestseller')::boolean, false),
             is_chef_pick = coalesce((r.j->>'chef_pick')::boolean, false), is_available = coalesce((r.j->>'available')::boolean, true)
       where id = v_exists;
      v_updated := v_updated + 1;
    end if;
    -- sizes in the file replace the dish's sizes (matched by name, so prices update in place); a file without sizes leaves them alone
    if r.j ? 'sizes' and jsonb_array_length(r.j->'sizes') > 0 then
      select id into v_item from public.items where category_id = v_cat and lower(name_en) = lower(btrim(r.j->>'name'));
      delete from public.item_variants where item_id = v_item
         and lower(name) <> all (select lower(btrim(z.value->>'name')) from jsonb_array_elements(r.j->'sizes') z);
      for sz in select e.value as j, e.ordinality as n from jsonb_array_elements(r.j->'sizes') with ordinality e loop
        insert into public.item_variants (restaurant_id, item_id, name, price_paise, sort_order)
        values (v_rid, v_item, btrim(sz.j->>'name'), (sz.j->>'price_paise')::int, sz.n)
        on conflict (item_id, lower(name)) do update set price_paise = excluded.price_paise, sort_order = excluded.sort_order;
      end loop;
      update public.items set price_paise = price_paise where id = v_item;
    end if;
  end loop;
  perform private.write_audit(v_rid, 'menu_import', 'items', null, jsonb_build_object('created', v_created, 'updated', v_updated, 'categories_created', v_cats));
  return jsonb_build_object('ok', true, 'created', v_created, 'updated', v_updated, 'categories_created', v_cats);
end $$;


-- ================= 0025_help_requests.sql =================
-- 0025: "Call for problems" for hotels and guest houses. One shared link per restaurant (reachable from the Smart page): the guest
-- types a room number, taps the problems that apply (towel, water, light, TV, WiFi...), may add a few words, and sends it.
-- It appears at once on the staff screen (reception) next to orders, with a sound, until someone taps Done.
-- The topics are the owner's list (defaults below). The optional room list of 0022 also validates the room here.
-- Like the room and table links, the token only identifies the restaurant; it cannot read anything. Idempotent.
-- Rollback: drop guest_get_help / guest_create_help / mgr_get_help_link / mgr_set_help_link / staff_resolve_help, the table and
-- the two columns; restore staff_get_board from 0015.

alter table public.restaurants
  add column if not exists help_token  text,
  add column if not exists help_topics text[] not null default array[
    'Towel or bedsheet', 'Room cleaning', 'Water not coming', 'Hot water not coming', 'Light not working', 'AC or heater problem',
    'TV not working', 'WiFi not working', 'Room service', 'Door lock or key problem', 'Noise or other guests', 'Medical help'];
do $$ begin
  alter table public.restaurants
    add constraint restaurants_help_token_format check (help_token is null or help_token ~ '^[0-9a-f]{64}$'),
    add constraint restaurants_help_topics_len check (coalesce(array_length(help_topics, 1), 0) <= 20);
exception when duplicate_object then null;
end $$;
create unique index if not exists restaurants_help_token_uq on public.restaurants (help_token) where help_token is not null;

create table if not exists public.help_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  room          text not null,
  topics        text[] not null default '{}',
  note          text,
  status        text not null default 'open',
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users (id) on delete set null,
  constraint help_requests_room check (char_length(room) between 1 and 10),
  constraint help_requests_note check (note is null or char_length(note) <= 300),
  constraint help_requests_topics check (coalesce(array_length(topics, 1), 0) <= 12),
  constraint help_requests_something check (coalesce(array_length(topics, 1), 0) > 0 or note is not null),
  constraint help_requests_status check (status in ('open', 'done'))
);
create index if not exists help_requests_open_idx on public.help_requests (restaurant_id, status, created_at);

-- Staff may read their own restaurant's problems (the live screen listens to this table); only the functions below write.
alter table public.help_requests enable row level security;
drop policy if exists help_requests_select on public.help_requests;
create policy help_requests_select on public.help_requests for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.my_role()) in ('owner', 'manager', 'waiter'));
revoke all on public.help_requests from public, anon, authenticated;
grant select on public.help_requests to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'help_requests') then
    alter publication supabase_realtime add table public.help_requests;
  end if;
end $$;

-- ---------- owner / manager: the link and its topics ----------
create or replace function public.mgr_get_help_link() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); r public.restaurants;
begin
  select * into r from public.restaurants where id = v_rid;
  return jsonb_build_object('enabled', r.help_token is not null, 'token', r.help_token, 'topics', to_jsonb(r.help_topics));
end $$;

-- p_enabled false switches the link off (token erased); p_rotate makes a new token. Empty topics fall back to the defaults.
create or replace function public.mgr_set_help_link(p_enabled boolean, p_topics text[], p_rotate boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner']);
  v_topics text[];
  r public.restaurants;
begin
  if p_enabled is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select coalesce(array_agg(t order by n), '{}') into v_topics from (
    select distinct on (lower(t)) t, n from (
      select btrim(regexp_replace(e, '\s+', ' ', 'g')) as t, n from unnest(coalesce(p_topics, '{}')) with ordinality as u(e, n)) q
     where t <> '' order by lower(t), n) d;
  if exists (select 1 from unnest(v_topics) t where char_length(t) > 40) or coalesce(array_length(v_topics, 1), 0) > 20 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into r from public.restaurants where id = v_rid for update;
  if coalesce(array_length(v_topics, 1), 0) = 0 then
    v_topics := r.help_topics;
    if coalesce(array_length(v_topics, 1), 0) = 0 then
      v_topics := array['Towel or bedsheet', 'Room cleaning', 'Water not coming', 'Light not working', 'TV not working', 'WiFi not working', 'Room service'];
    end if;
  end if;
  update public.restaurants
     set help_topics = v_topics,
         help_token = case when not p_enabled then null
                           when r.help_token is null or coalesce(p_rotate, false)
                             then replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
                           else r.help_token end
   where id = v_rid;
  perform private.write_audit(v_rid, 'help_link_updated', 'restaurants', v_rid::text,
    jsonb_build_object('enabled', p_enabled, 'topics', coalesce(array_length(v_topics, 1), 0), 'rotated', coalesce(p_rotate, false)));
end $$;
revoke all on function public.mgr_get_help_link(), public.mgr_set_help_link(boolean, text[], boolean) from public, anon, service_role;
grant execute on function public.mgr_get_help_link(), public.mgr_set_help_link(boolean, text[], boolean) to authenticated;

-- ---------- guest: what the page needs, and sending a problem (service role only) ----------
create or replace function public.guest_get_help(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.help_token is null or p_token is null or r.help_token <> p_token then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  return jsonb_build_object('status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent, 'logo_path', r.logo_path),
    'topics', to_jsonb(r.help_topics),
    'rooms', to_jsonb(r.room_numbers));
end $$;

create or replace function public.guest_create_help(p_slug text, p_token text, p_room text, p_topics text[], p_note text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_room text := upper(regexp_replace(btrim(coalesce(p_room, '')), '\s+', ' ', 'g'));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_topics text[];
  q public.help_requests;
begin
  if p_slug is null or p_token is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_ip_hash is not null and not private.rl_hit('help:' || p_ip_hash, 20, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;
  select * into r from public.restaurants where slug = p_slug and help_token = p_token;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  if v_room !~ '^[A-Z0-9][A-Z0-9 -]{0,9}$' or (v_note is not null and char_length(v_note) > 300) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if coalesce(array_length(r.room_numbers, 1), 0) > 0 and not (v_room = any (r.room_numbers)) then
    raise exception using errcode = 'GM022', message = 'unknown_room';
  end if;
  -- only the owner's topics (any letter case), each once, in the owner's order
  select coalesce(array_agg(t order by n), '{}') into v_topics
    from unnest(r.help_topics) with ordinality as o(t, n)
   where lower(t) in (select lower(btrim(x)) from unnest(coalesce(p_topics, '{}')) x);
  if coalesce(array_length(p_topics, 1), 0) > 12
     or (select count(distinct lower(btrim(x))) from unnest(coalesce(p_topics, '{}')) x) <> coalesce(array_length(v_topics, 1), 0)
     or (coalesce(array_length(v_topics, 1), 0) = 0 and v_note is null) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  -- sending the same thing again within 10 minutes is the same request (a double tap or a retry)
  select * into q from public.help_requests
   where restaurant_id = r.id and room = v_room and status = 'open' and topics = v_topics
     and note is not distinct from v_note and created_at > now() - interval '10 minutes'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('id', q.id, 'room', q.room, 'replayed', true);
  end if;
  if (select count(*) from public.help_requests where restaurant_id = r.id and room = v_room and status = 'open') >= 3 then
    raise exception using errcode = 'GM008', message = 'too_many_pending';
  end if;
  if (select count(*) from public.help_requests where restaurant_id = r.id and status = 'open') >= 300 then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  insert into public.help_requests (restaurant_id, room, topics, note) values (r.id, v_room, v_topics, v_note) returning * into q;
  return jsonb_build_object('id', q.id, 'room', q.room, 'replayed', false);
end $$;
revoke all on function public.guest_get_help(text, text), public.guest_create_help(text, text, text, text[], text, text) from public, anon, authenticated;
grant execute on function public.guest_get_help(text, text), public.guest_create_help(text, text, text, text[], text, text) to service_role;

-- ---------- staff: mark a problem done ----------
create or replace function public.staff_resolve_help(p_help_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; q public.help_requests;
begin
  v_rid := private.require_staff(array['owner','manager','waiter']);
  update public.help_requests set status = 'done', resolved_at = now(), resolved_by = auth.uid()
   where id = p_help_id and restaurant_id = v_rid and status = 'open'
   returning * into q;
  if not found then
    -- already done (double tap) is fine; a missing or foreign id is not
    select * into q from public.help_requests where id = p_help_id and restaurant_id = v_rid;
    if not found then
      raise exception using errcode = 'GM012', message = 'not_found';
    end if;
  end if;
  return jsonb_build_object('help_id', q.id, 'status', q.status);
end $$;
revoke all on function public.staff_resolve_help(uuid) from public, anon, service_role;
grant execute on function public.staff_resolve_help(uuid) to authenticated;

-- ---------- the staff board also carries the open problems (not for the kitchen) ----------
create or replace function public.staff_get_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return jsonb_build_object(
    'server_time', now(),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status, 'table_label', t.label, 'session_id', o.session_id,
        'note', o.note, 'total_paise', o.total_paise, 'created_at', o.created_at, 'preparing_at', o.preparing_at,
        'ready_at', o.ready_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_en_snapshot, 'qty', oi.qty, 'note', oi.note)
                                            order by oi.name_en_snapshot)
                           from public.order_items oi where oi.order_id = o.id), '[]'::jsonb))
        order by o.created_at)
      from public.orders o
      join public.dining_tables t on t.id = o.table_id
      join public.table_sessions s on s.id = o.session_id
      where o.restaurant_id = v_rid and s.closed_at is null and o.status in ('placed', 'preparing', 'ready')), '[]'::jsonb),
    -- the kitchen does not handle waiter calls, bills or payment
    'requests', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode, 'table_label', t.label,
        'session_id', q.session_id, 'created_at', q.created_at) order by q.created_at)
      from public.service_requests q join public.dining_tables t on t.id = q.table_id
      where q.restaurant_id = v_rid and q.status = 'open'), '[]'::jsonb) end,
    'sessions', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'table_label', t.label, 'opened_at', s.opened_at, 'pay_mode', s.pay_mode,
        'bill_requested_at', s.bill_requested_at,
        'total_paise', coalesce((select sum(o.total_paise) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'), 0),
        'orders_count', (select count(*) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'),
        'unserved_count', (select count(*) from public.orders o where o.session_id = s.id and o.status in ('placed', 'preparing', 'ready')))
        order by s.opened_at)
      from public.table_sessions s join public.dining_tables t on t.id = s.table_id
      where s.restaurant_id = v_rid and s.closed_at is null), '[]'::jsonb) end,
    'help', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'room', h.room, 'topics', to_jsonb(h.topics), 'note', h.note, 'created_at', h.created_at)
                       order by h.created_at)
      from public.help_requests h where h.restaurant_id = v_rid and h.status = 'open'), '[]'::jsonb) end);
end $$;

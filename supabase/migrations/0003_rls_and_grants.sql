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

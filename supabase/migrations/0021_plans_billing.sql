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


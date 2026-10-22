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

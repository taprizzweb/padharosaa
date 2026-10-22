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

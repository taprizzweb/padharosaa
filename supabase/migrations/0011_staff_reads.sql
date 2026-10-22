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

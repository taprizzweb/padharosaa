-- 0044_order_handover_guest
-- The GUEST picks how an order from a Padharosaa hotel reaches them: Room delivery, or Takeaway (collect at the desk, with a pickup time).
-- The kitchen still sees the choice on the order and can change it. A hotel with room dining switched off never accepts Room delivery.
-- orders.handover_minutes = the pickup time the guest chose (Takeaway only). The status and board functions now return it, and the
-- status also says whether the hotel does room dining.
-- Idempotent. Rollback: restore staff_get_board / guest_get_status from 0037, drop guest_set_order_handover and the column.

alter table public.orders add column if not exists handover_minutes int check (handover_minutes is null or handover_minutes between 5 and 180);

-- Service role only (called by /api/guest/order right after the order is placed). The guest can only touch an order on THEIR table,
-- while it is still waiting ('placed'), and only in a room of a hotel.
create or replace function public.guest_set_order_handover(p_slug text, p_token text, p_order_no bigint, p_mode text, p_minutes int default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; t public.dining_tables; o public.orders; v_dining boolean;
begin
  if p_mode is null or p_mode not in ('deliver','takeaway') or (p_minutes is not null and p_minutes not between 5 and 180) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into r from public.restaurants where slug = p_slug;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into t from public.dining_tables where restaurant_id = r.id and qr_token = p_token and active;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into o from public.orders where restaurant_id = r.id and table_id = t.id and order_no = p_order_no for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if t.kind is distinct from 'room' or o.status <> 'placed' then raise exception using errcode = 'GM010', message = 'invalid_transition'; end if;
  select h.room_dining into v_dining from public.hotel_settings h where h.restaurant_id = r.id and h.enabled;
  if not found then raise exception using errcode = 'GM015', message = 'invalid_input'; end if; -- not a hotel: no such choice
  if p_mode = 'deliver' and coalesce(v_dining, true) = false then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.orders set handover = p_mode, handover_at = now(), handover_minutes = case when p_mode = 'takeaway' then p_minutes else null end where id = o.id returning * into o;
  return jsonb_build_object('handover', o.handover, 'handover_minutes', o.handover_minutes);
end $$;
revoke all on function public.guest_set_order_handover(text, text, bigint, text, int) from public, anon, authenticated;
grant execute on function public.guest_set_order_handover(text, text, bigint, text, int) to service_role;

-- the kitchen changing it: Room delivery clears the pickup time
create or replace function public.staff_set_order_handover(p_order_id uuid, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager','waiter','kitchen']); o public.orders; v_kind text; v_dining boolean;
begin
  if p_mode is null or p_mode not in ('deliver','takeaway') then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into o from public.orders where id = p_order_id and restaurant_id = v_rid for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select kind into v_kind from public.dining_tables where id = o.table_id;
  if v_kind is distinct from 'room' or o.status not in ('placed','preparing','ready') then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  select h.room_dining into v_dining from public.hotel_settings h where h.restaurant_id = v_rid;
  if p_mode = 'deliver' and coalesce(v_dining, true) = false then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.orders set handover = p_mode, handover_at = now(), handover_minutes = case when p_mode = 'deliver' then null else handover_minutes end where id = o.id returning * into o;
  perform private.write_audit(v_rid, 'order_handover_set', 'orders', o.id::text, jsonb_build_object('order_no', o.order_no, 'mode', p_mode));
  return jsonb_build_object('order_id', o.id, 'handover', o.handover);
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
    'room_dining', coalesce((select h.room_dining from public.hotel_settings h where h.restaurant_id = v_rid), true),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status, 'table_label', t.label, 'session_id', o.session_id,
        'note', o.note, 'total_paise', o.total_paise, 'created_at', o.created_at, 'preparing_at', o.preparing_at,
        'ready_at', o.ready_at, 'handover', o.handover, 'handover_minutes', o.handover_minutes, 'is_room', t.kind = 'room',
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
    'room_dining', coalesce((select h.room_dining from public.hotel_settings h where h.restaurant_id = s.restaurant_id and h.enabled), true),
    'pay_mode', s.pay_mode,
    'bill_requested', s.bill_requested_at is not null,
    'total_paise', coalesce(s.final_total_paise, (
        select coalesce(sum(o.total_paise), 0) from public.orders o where o.session_id = s.id and o.status <> 'cancelled')),
    'review_available', s.closed_at is not null and r.review_url is not null,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_no', o.order_no, 'status', o.status, 'note', o.note, 'total_paise', o.total_paise,
        'created_at', o.created_at, 'cancel_reason', o.cancel_reason, 'handover', o.handover, 'handover_minutes', o.handover_minutes,
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

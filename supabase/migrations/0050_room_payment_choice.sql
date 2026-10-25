-- 0050_room_payment_choice
-- After a room order the guest chooses, on the order screen itself: "Add to room receipt" (it goes on the room bill) or "Pay now" (the
-- hotel's own payment QR is shown, a photo of its UPI scanner that the owner uploads once in Manage). The desk sees the choice on the order.
--   hotel_settings.pay_qr_path   the QR image (a path in the menu-images bucket, under the hotel's own folder), or empty
--   orders.pay_method            null | 'room_bill' | 'pay_now'
-- Idempotent. Rollback: restore staff_get_board / guest_get_status from 0045 and padh_manage_settings from 0048, drop guest_set_order_pay and
-- padh_set_pay_qr, then drop the two columns.
alter table public.hotel_settings add column if not exists pay_qr_path text check (pay_qr_path is null or char_length(pay_qr_path) <= 300);
alter table public.orders add column if not exists pay_method text check (pay_method is null or pay_method in ('room_bill','pay_now'));

-- owner or manager sets or clears the payment QR image; the file must sit in the hotel's own folder
create or replace function public.padh_set_pay_qr(p_path text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  if p_path is not null and (p_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,120}$' or split_part(p_path, '/', 1) <> v_rid::text) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.hotel_settings set pay_qr_path = p_path where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_pay_qr_set', 'hotel_settings', v_rid::text, jsonb_build_object('set', p_path is not null));
  return jsonb_build_object('pay_qr_path', p_path);
end $$;
revoke all on function public.padh_set_pay_qr(text) from public, anon, service_role;
grant execute on function public.padh_set_pay_qr(text) to authenticated;

-- the guest's choice for one of their own room orders; "pay now" needs the hotel to have a payment QR
create or replace function public.guest_set_order_pay(p_slug text, p_token text, p_order_no bigint, p_method text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; t public.dining_tables; o public.orders; h public.hotel_settings;
begin
  if p_method is null or p_method not in ('room_bill','pay_now') then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into r from public.restaurants where slug = p_slug;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into t from public.dining_tables where restaurant_id = r.id and qr_token = p_token and active;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into o from public.orders where restaurant_id = r.id and table_id = t.id and order_no = p_order_no for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into h from public.hotel_settings where restaurant_id = r.id and enabled;
  if not found or t.kind <> 'room' or o.status = 'cancelled' or (p_method = 'pay_now' and h.pay_qr_path is null) then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  update public.orders set pay_method = p_method where id = o.id;
  perform private.write_audit(r.id, 'order_pay_method_set', 'orders', o.id::text, jsonb_build_object('order_no', o.order_no, 'method', p_method));
  return jsonb_build_object('pay_method', p_method);
end $$;
revoke all on function public.guest_set_order_pay(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.guest_set_order_pay(text, text, bigint, text) to service_role;

create or replace function public.padh_manage_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); h public.hotel_settings; r public.restaurants;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  select * into r from public.restaurants where id = v_rid;
  return jsonb_build_object('brand_color', h.brand_color, 'logo_path', h.logo_path, 'hero_path', h.hero_path, 'tripadvisor_url', h.tripadvisor_url,
    'menu_url', h.menu_url, 'review_link', coalesce(h.review_link, r.review_url), 'offer_text', h.offer_text, 'offer_until', h.offer_until, 'info_text', h.info_text,
    'wifi_name', h.wifi_name, 'checkout_time', h.checkout_time, 'breakfast_text', h.breakfast_text, 'reception_phone', h.reception_phone,
    'manager_phone', h.manager_phone, 'room_dining', h.room_dining, 'kitchen_display', h.kitchen_display, 'instagram', r.instagram_url,
    'service_start', to_char(h.service_start, 'HH24:MI'), 'service_end', to_char(h.service_end, 'HH24:MI'), 'pay_qr_path', h.pay_qr_path);
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
        'ready_at', o.ready_at, 'handover', o.handover, 'handover_minutes', o.handover_minutes, 'ready_in_at', o.ready_in_at, 'guest_eta_minutes', o.guest_eta_minutes, 'guest_eta_at', o.guest_eta_at, 'is_room', t.kind = 'room', 'pay_method', o.pay_method,
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
    'is_room', (select t.kind = 'room' from public.dining_tables t where t.id = s.table_id),
    'pay_qr_path', (select h.pay_qr_path from public.hotel_settings h where h.restaurant_id = s.restaurant_id and h.enabled),
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
        'ready_in_at', o.ready_in_at, 'guest_eta_minutes', o.guest_eta_minutes, 'guest_eta_at', o.guest_eta_at, 'pay_method', o.pay_method,
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

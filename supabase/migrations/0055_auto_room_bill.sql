-- 0055_auto_room_bill
-- Optional hotel setting "Bill every room order to the room automatically". When it is on, a food order from a room is put on the room
-- receipt the moment it is placed (orders.pay_method = 'room_bill'), without asking the guest. The guest can still change it to
-- "Pay now" on the order screen (when the hotel has a payment QR). Only room orders are touched; table orders are never changed.
-- Idempotent. Rollback: drop trigger padh_auto_room_bill on public.orders, drop the two functions, drop the column,
-- restore padh_manage_settings from 0050.
alter table public.hotel_settings add column if not exists auto_room_bill boolean not null default false;

create or replace function private.padh_auto_room_bill() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pay_method is null and exists (
    select 1 from public.dining_tables t join public.hotel_settings h on h.restaurant_id = t.restaurant_id
     where t.id = new.table_id and t.kind = 'room' and h.enabled and h.auto_room_bill) then
    new.pay_method := 'room_bill';
  end if;
  return new;
end $$;
create or replace trigger padh_auto_room_bill before insert on public.orders for each row execute function private.padh_auto_room_bill();

create or replace function public.padh_set_auto_room_bill(p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  if p_on is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.hotel_settings set auto_room_bill = p_on where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_auto_room_bill_set', 'hotel_settings', v_rid::text, jsonb_build_object('on', p_on));
  return jsonb_build_object('auto_room_bill', p_on);
end $$;
revoke all on function public.padh_set_auto_room_bill(boolean) from public, anon, service_role;
grant execute on function public.padh_set_auto_room_bill(boolean) to authenticated;

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
    'service_start', to_char(h.service_start, 'HH24:MI'), 'service_end', to_char(h.service_end, 'HH24:MI'), 'pay_qr_path', h.pay_qr_path,
    'auto_room_bill', h.auto_room_bill);
end $$;

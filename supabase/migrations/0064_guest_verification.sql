-- Guest verification: the owner or manager chooses whether a guest needs the 4-digit stay code from reception to sign in.
-- 'light' = name, mobile and a real room number. 'strict' = the room's current stay code as well (see padh_issue_stay_code).
create or replace function public.padh_set_verification(p_level text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  if p_level is null or p_level not in ('light','strict') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.hotel_settings set verification_level = p_level, updated_at = now() where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_verification_set', 'hotel_settings', v_rid::text, jsonb_build_object('level', p_level));
  return jsonb_build_object('verification_level', p_level);
end $$;
revoke all on function public.padh_set_verification(text) from public, anon, service_role;
grant execute on function public.padh_set_verification(text) to authenticated;

-- the console reads the current level
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
    'auto_room_bill', h.auto_room_bill, 'verification_level', h.verification_level);
end $$;

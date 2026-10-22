-- 0034_padharosaa_manage_settings
-- One read for the manager screen: everything it edits (never the Wi-Fi password, which is write-only), in a single checked call.
-- Idempotent. Rollback: drop function public.padh_manage_settings().
create or replace function public.padh_manage_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); h public.hotel_settings; r public.restaurants;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  select * into r from public.restaurants where id = v_rid;
  return jsonb_build_object('brand_color', h.brand_color, 'logo_path', h.logo_path, 'hero_path', h.hero_path, 'tripadvisor_url', h.tripadvisor_url,
    'menu_url', h.menu_url, 'review_link', coalesce(h.review_link, r.review_url), 'offer_text', h.offer_text, 'offer_until', h.offer_until, 'info_text', h.info_text,
    'wifi_name', h.wifi_name, 'checkout_time', h.checkout_time, 'breakfast_text', h.breakfast_text, 'reception_phone', h.reception_phone,
    'manager_phone', h.manager_phone, 'room_dining', h.room_dining, 'instagram', r.instagram_url);
end $$;
revoke all on function public.padh_manage_settings() from public, anon, service_role;
grant execute on function public.padh_manage_settings() to authenticated;

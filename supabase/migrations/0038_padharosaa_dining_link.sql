-- 0038_padharosaa_dining_link
-- What the guest app needs to open Dining: the room, whether room dining is on, and where the menu lives -- either the link the manager
-- pasted (a separate cafe) or this hotel's own restaurant room link. The app turns this into the menu address (with the room already filled in).
-- Idempotent. Rollback: drop function public.padh_guest_dining(uuid).
create or replace function public.padh_guest_dining(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings; r public.restaurants; v_room text;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  select * into r from public.restaurants where id = s.restaurant_id;
  select number into v_room from public.rooms where id = s.room_id;
  return jsonb_build_object('room', v_room, 'room_dining', h.room_dining, 'menu_url', h.menu_url, 'own_slug', r.slug, 'own_room_token', r.room_token, 'hotel_slug', r.slug);
end $$;
revoke all on function public.padh_guest_dining(uuid) from public, anon, authenticated;
grant execute on function public.padh_guest_dining(uuid) to service_role;

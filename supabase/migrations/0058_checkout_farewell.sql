-- 0058_checkout_farewell
-- When reception checks a room out, the guest's phone is signed out. Instead of dropping them on a sign-in page, the phone shows a
-- thank-you screen that asks for a Google review (the hotel's own review link). Only a session that ended because of a check-out
-- qualifies, only for 14 days, and the answer holds nothing private: the guest's first name, the hotel, its colour and its review links.
-- Idempotent. Rollback: drop padh_guest_farewell and the column, restore padh_checkout_room from 0052.
alter table public.guest_sessions add column if not exists end_reason text check (end_reason is null or end_reason in ('checkout'));

create or replace function public.padh_checkout_room(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); v_n int; v_number text;
begin
  select number into v_number from public.rooms where id = p_room and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  update public.guest_sessions set status = 'ended', ended_at = now(), end_reason = 'checkout' where restaurant_id = v_rid and room_id = p_room and status = 'active';
  get diagnostics v_n = row_count;
  update public.stay_codes set valid_until = now() where restaurant_id = v_rid and room_id = p_room and (valid_until is null or valid_until > now());
  -- the room's own menu link stops working (a new one is handed to the next guest)
  update public.dining_tables set qr_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
   where restaurant_id = v_rid and kind = 'room' and label = 'Room ' || upper(v_number);
  perform private.write_audit(v_rid, 'padh_room_checkout', 'rooms', p_room::text, jsonb_build_object('room', v_number, 'sessions_ended', v_n));
  return jsonb_build_object('room', v_number, 'sessions_ended', v_n);
end $$;

-- what the signed-out phone may show: only for a session that ended at check-out, within 14 days
create or replace function public.padh_guest_farewell(p_token_hash bytea) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings; r public.restaurants;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then return jsonb_build_object('ok', false); end if;
  select * into s from public.guest_sessions where token_hash = p_token_hash and status = 'ended' and end_reason = 'checkout' and ended_at > now() - interval '14 days';
  if not found then return jsonb_build_object('ok', false); end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  select * into r from public.restaurants where id = s.restaurant_id;
  return jsonb_build_object('ok', true, 'name', split_part(s.guest_name, ' ', 1), 'hotel_name', r.name, 'slug', r.slug, 'language', s.language,
    'brand_color', h.brand_color, 'google_review_url', coalesce(h.review_link, r.review_url), 'tripadvisor_url', h.tripadvisor_url);
end $$;
revoke all on function public.padh_guest_farewell(bytea) from public, anon, authenticated;
grant execute on function public.padh_guest_farewell(bytea) to service_role;

-- 0052_checkout_signs_out_everywhere
-- "Room 102 has checked out": reception, the manager or the owner taps it and the guest is signed out of the hotel app at once, so nobody
-- can send requests or place orders from that room afterwards. It already ended the Padharosaa sessions and the stay code. It now also
-- gives the room a NEW menu link (the room's table token), so an old browser tab or a saved link can no longer order food for that room.
-- The next guest of the room is not affected: they get the new link when they sign in. Orders already placed stay as they are.
-- Idempotent. Rollback: restore padh_checkout_room from 0028.
create or replace function public.padh_checkout_room(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); v_n int; v_number text;
begin
  select number into v_number from public.rooms where id = p_room and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  update public.guest_sessions set status = 'ended', ended_at = now() where restaurant_id = v_rid and room_id = p_room and status = 'active';
  get diagnostics v_n = row_count;
  update public.stay_codes set valid_until = now() where restaurant_id = v_rid and room_id = p_room and (valid_until is null or valid_until > now());
  -- the room's own menu link stops working (a new one is handed to the next guest)
  update public.dining_tables set qr_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
   where restaurant_id = v_rid and kind = 'room' and label = 'Room ' || upper(v_number);
  perform private.write_audit(v_rid, 'padh_room_checkout', 'rooms', p_room::text, jsonb_build_object('room', v_number, 'sessions_ended', v_n));
  return jsonb_build_object('room', v_number, 'sessions_ended', v_n);
end $$;

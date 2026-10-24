-- 0043_padharosaa_room_service_auto
-- A Padharosaa hotel's Dining screen opens the hotel's own menu on its room-service link. That link used to exist only after someone
-- switched room service on in the menu dashboard, so a new hotel's Dining screen said "not available". Now:
--   * a hotel always has its room-service link (made when Padharosaa is switched on), and
--   * the menu's list of valid rooms is the hotel's active rooms (kept in step when rooms are added or switched off).
-- Idempotent. Rollback: drop the trigger and private.sync_room_service, and restore padh_rooms_add / padh_rooms_set_active from 0040.

create or replace function private.sync_room_service(p_rid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rooms text[];
begin
  select coalesce(array_agg(number order by number), '{}') into v_rooms from public.rooms where restaurant_id = p_rid and active;
  update public.restaurants
     set room_numbers = case when coalesce(array_length(v_rooms, 1), 0) <= 300 then v_rooms else room_numbers end,
         room_token = coalesce(room_token, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
   where id = p_rid;
end $$;
revoke all on function private.sync_room_service(uuid) from public, anon, authenticated, service_role;

create or replace function private.hotel_room_service_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.enabled then perform private.sync_room_service(new.restaurant_id); end if;
  return new;
end $$;
revoke all on function private.hotel_room_service_trg() from public, anon, authenticated, service_role;
drop trigger if exists hotel_room_service on public.hotel_settings;
create trigger hotel_room_service after insert or update of enabled on public.hotel_settings for each row execute function private.hotel_room_service_trg();

create or replace function public.padh_rooms_add(p_numbers text[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_nums text[]; n text; v_added int := 0; v_total int;
begin
  if p_numbers is null or cardinality(p_numbers) not between 1 and 100 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select coalesce(array_agg(distinct upper(btrim(private.clean_text(x)))), '{}') into v_nums from unnest(p_numbers) x;
  foreach n in array v_nums loop
    if n !~ '^[A-Z0-9][A-Z0-9 -]{0,9}$' then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  end loop;
  select count(*) into v_total from public.rooms where restaurant_id = v_rid and number <> all (v_nums);
  if v_total + cardinality(v_nums) > 300 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  with ins as (
    insert into public.rooms (restaurant_id, number) select v_rid, x from unnest(v_nums) x
    on conflict (restaurant_id, number) do update set active = true where public.rooms.active = false
    returning 1)
  select count(*) into v_added from ins;
  perform private.sync_room_service(v_rid);
  perform private.write_audit(v_rid, 'padh_rooms_added', 'rooms', v_rid::text, jsonb_build_object('count', v_added));
  return jsonb_build_object('added', v_added, 'requested', cardinality(v_nums));
end $$;

create or replace function public.padh_rooms_set_active(p_room uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); rm public.rooms;
begin
  if p_room is null or p_active is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into rm from public.rooms where id = p_room and restaurant_id = v_rid for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  update public.rooms set active = p_active where id = rm.id;
  if not p_active then
    update public.guest_sessions set status = 'ended', ended_at = now() where room_id = rm.id and status = 'active';
  end if;
  perform private.sync_room_service(v_rid);
  perform private.write_audit(v_rid, case when p_active then 'padh_room_on' else 'padh_room_off' end, 'rooms', rm.id::text, '{}'::jsonb);
end $$;

-- hotels that already exist
do $$ declare r record; begin
  for r in select restaurant_id from public.hotel_settings where enabled loop perform private.sync_room_service(r.restaurant_id); end loop;
end $$;

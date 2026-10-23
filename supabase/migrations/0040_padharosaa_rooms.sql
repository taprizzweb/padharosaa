-- 0040_padharosaa_rooms
-- Rooms of a Padharosaa hotel can be listed, added and switched on/off from the manager page. Before this the rooms table could only
-- be filled by the room-service list or by hand in SQL. Soft only: a room is switched off, never deleted (its history stays).
-- Idempotent. Rollback: drop the three functions.

create or replace function public.padh_rooms_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'active', r.active,
             'guests', (select count(*) from public.guest_sessions g where g.room_id = r.id and g.status = 'active')) order by r.number)
      from public.rooms r where r.restaurant_id = v_rid), '[]'::jsonb);
end $$;

-- adds rooms ("101", "201 A"); a switched-off room comes back on; at most 300 rooms per hotel, 100 numbers per call
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
  perform private.write_audit(v_rid, 'padh_rooms_added', 'rooms', v_rid::text, jsonb_build_object('count', v_added));
  return jsonb_build_object('added', v_added, 'requested', cardinality(v_nums));
end $$;

-- switch a room off (its live guest sessions end) or back on
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
  perform private.write_audit(v_rid, case when p_active then 'padh_room_on' else 'padh_room_off' end, 'rooms', rm.id::text, '{}'::jsonb);
end $$;

revoke all on function public.padh_rooms_list(), public.padh_rooms_add(text[]), public.padh_rooms_set_active(uuid, boolean) from public, anon, service_role;
grant execute on function public.padh_rooms_list(), public.padh_rooms_add(text[]), public.padh_rooms_set_active(uuid, boolean) to authenticated;

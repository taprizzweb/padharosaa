-- 0057_demo_hotel
-- A public demo hotel: the platform admin switches "public demo" on for one hotel, and anyone with its demo link tries the guest app on
-- their phone with no sign-in (a manager during a pitch). Each visitor gets a fresh guest session in a free demo room. To make the demo
-- feel alive, a demo guest's requests and food orders move along by themselves (accepted after a few seconds, then done), as if a desk
-- were answering. Only a hotel with is_demo = true is ever reachable this way; a real hotel is never affected.
-- Idempotent. Rollback: drop the three functions and the column.
alter table public.hotel_settings add column if not exists is_demo boolean not null default false;

-- platform admin: switch the public demo on or off (and make sure the demo has a few rooms)
create or replace function public.padh_admin_set_demo(p_admin uuid, p_restaurant uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h public.hotel_settings;
begin
  perform private.require_admin(p_admin);
  if p_on is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into h from public.hotel_settings where restaurant_id = p_restaurant;
  if not found or not h.enabled then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  update public.hotel_settings set is_demo = p_on where restaurant_id = p_restaurant;
  if p_on then
    insert into public.rooms (restaurant_id, number) select p_restaurant, 'D' || g from generate_series(1, 8) g on conflict (restaurant_id, number) do nothing;
  end if;
  perform private.write_audit(p_restaurant, 'padh_demo_set', 'hotel_settings', p_restaurant::text, jsonb_build_object('on', p_on));
  return jsonb_build_object('is_demo', p_on);
end $$;
revoke all on function public.padh_admin_set_demo(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.padh_admin_set_demo(uuid, uuid, boolean) to service_role;

-- is this hotel a public demo (the demo page asks before it shows a button)
create or replace function public.padh_demo_info(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('name', r.name, 'slug', r.slug) from public.restaurants r join public.hotel_settings h on h.restaurant_id = r.id
                    where r.slug = p_slug and r.status = 'active' and h.enabled and h.is_demo), 'null'::jsonb)
$$;
revoke all on function public.padh_demo_info(text) from public, anon, authenticated;
grant execute on function public.padh_demo_info(text) to service_role;

-- a visitor enters the demo: a new guest session in a free demo room (the oldest demo session is moved on when all rooms are in use)
create or replace function public.padh_demo_enter(p_slug text, p_token_hash bytea, p_mobile_enc bytea, p_mobile_hash bytea, p_ip_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.restaurants; h public.hotel_settings; v_room public.rooms; s public.guest_sessions; v_old uuid; v_oldroom uuid;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 or p_mobile_enc is null or p_mobile_hash is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into r from public.restaurants where slug = p_slug and status = 'active';
  select * into h from public.hotel_settings where restaurant_id = r.id;
  if r.id is null or h.restaurant_id is null or not h.enabled or not h.is_demo then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if not private.rl_hit('padh_demo:' || r.id::text || ':' || coalesce(p_ip_hash, 'none'), 20, 3600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;
  -- demo visits older than three hours are over
  update public.guest_sessions set status = 'ended', ended_at = now() where restaurant_id = r.id and status = 'active' and started_at < now() - interval '3 hours';
  select * into v_room from public.rooms rm where rm.restaurant_id = r.id and rm.active
     and not exists (select 1 from public.guest_sessions g where g.restaurant_id = r.id and g.room_id = rm.id and g.status = 'active') order by rm.number limit 1;
  if not found then
    select g.id, g.room_id into v_old, v_oldroom from public.guest_sessions g where g.restaurant_id = r.id and g.status = 'active' order by g.started_at limit 1;
    update public.guest_sessions set status = 'ended', ended_at = now() where id = v_old;
    select * into v_room from public.rooms where id = v_oldroom;
  end if;
  insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, language, token_hash, verification)
  values (r.id, v_room.id, 'Demo guest', '+91', p_mobile_enc, p_mobile_hash, 'en', p_token_hash, 'none') returning * into s;
  perform private.bot_say(r.id, s.id, 'chat.welcome', jsonb_build_object('name', 'Demo', 'hotel', r.name, 'room', v_room.number), null, '["dining","plan_my_day","reservations","jaipur_guide"]'::jsonb);
  return jsonb_build_object('session_id', s.id, 'slug', r.slug, 'room', v_room.number);
end $$;
revoke all on function public.padh_demo_enter(text, bytea, bytea, bytea, text) from public, anon, authenticated;
grant execute on function public.padh_demo_enter(text, bytea, bytea, bytea, text) to service_role;

-- a demo guest's requests and orders answer themselves: accepted after 6 seconds, done after 15 more; orders: preparing, ready, served
create or replace function public.padh_demo_tick(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.requests;
begin
  if not exists (select 1 from public.guest_sessions g join public.hotel_settings h on h.restaurant_id = g.restaurant_id where g.id = p_session and g.status = 'active' and h.is_demo) then return; end if;
  for q in update public.requests set status = 'accepted', accepted_at = now(), version = version + 1, updated_at = now()
            where session_id = p_session and status = 'received' and created_at < now() - interval '6 seconds' returning * loop
    perform private.req_event(q, 'system', null, 'accepted');
    perform private.bot_say(q.restaurant_id, q.session_id, 'msg.accepted', jsonb_build_object('team', private.team_label(q.team), 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'label', q.label), q.id);
  end loop;
  for q in update public.requests set status = 'completed', completed_at = now(), resolution = case when type = 'help' then 'fixed' else null end, version = version + 1, updated_at = now()
            where session_id = p_session and status = 'accepted' and accepted_at < now() - interval '15 seconds' returning * loop
    perform private.req_event(q, 'system', null, 'completed');
    if q.type = 'help' then
      perform private.bot_say(q.restaurant_id, q.session_id, 'msg.resolved', jsonb_build_object('outcome', 'fixed'), q.id, '["resolved_yes","resolved_no"]'::jsonb);
    else
      perform private.bot_say(q.restaurant_id, q.session_id, 'msg.completed', jsonb_build_object('label', q.label), q.id, '["anything_else"]'::jsonb);
    end if;
  end loop;
  -- the room's own food orders (a room's dining table is labelled "Room <number>")
  update public.orders o set status = 'preparing', preparing_at = now() where o.status = 'placed' and o.created_at < now() - interval '8 seconds' and o.table_id in (select t.id from public.dining_tables t join public.rooms rm on t.label = 'Room ' || upper(rm.number) and t.restaurant_id = rm.restaurant_id join public.guest_sessions g on g.room_id = rm.id where g.id = p_session and t.kind = 'room');
  update public.orders o set status = 'ready', ready_at = now() where o.status = 'preparing' and o.preparing_at < now() - interval '15 seconds' and o.table_id in (select t.id from public.dining_tables t join public.rooms rm on t.label = 'Room ' || upper(rm.number) and t.restaurant_id = rm.restaurant_id join public.guest_sessions g on g.room_id = rm.id where g.id = p_session and t.kind = 'room');
  update public.orders o set status = 'served', served_at = now() where o.status = 'ready' and o.ready_at < now() - interval '15 seconds' and o.table_id in (select t.id from public.dining_tables t join public.rooms rm on t.label = 'Room ' || upper(rm.number) and t.restaurant_id = rm.restaurant_id join public.guest_sessions g on g.room_id = rm.id where g.id = p_session and t.kind = 'room');
end $$;
revoke all on function public.padh_demo_tick(uuid) from public, anon, authenticated;
grant execute on function public.padh_demo_tick(uuid) to service_role;

-- the guest session lookup also says whether this is a public demo (so only demo guests pay for the self-answering step)
create or replace function public.padh_guest_resolve_session(p_token_hash bytea) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings; r public.restaurants; rm public.rooms;
begin
  if p_token_hash is null or octet_length(p_token_hash) <> 32 then
    return jsonb_build_object('ok', false);
  end if;
  select * into s from public.guest_sessions where token_hash = p_token_hash;
  if not found or s.status <> 'active' then
    return jsonb_build_object('ok', false);
  end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  select * into r from public.restaurants where id = s.restaurant_id;
  if h.restaurant_id is null or not h.enabled or r.status <> 'active' then
    return jsonb_build_object('ok', false);
  end if;
  if s.started_at + make_interval(days => h.max_stay_days) < now()
     or (h.verification_level in ('strict','verified') and s.last_seen_at < now() - interval '12 hours') then
    update public.guest_sessions set status = 'expired', ended_at = now() where id = s.id;
    return jsonb_build_object('ok', false, 'expired', true);
  end if;
  if s.last_seen_at < now() - interval '1 minute' then
    update public.guest_sessions set last_seen_at = now() where id = s.id;
  end if;
  select * into rm from public.rooms where id = s.room_id;
  return jsonb_build_object('ok', true, 'session_id', s.id, 'restaurant_id', s.restaurant_id, 'room', rm.number, 'name', s.guest_name,
    'language', s.language, 'diet', s.diet, 'occasion', s.occasion, 'hotel_name', r.name, 'slug', r.slug, 'theme', h.theme,
    'verification_level', h.verification_level, 'timezone', h.timezone, 'is_demo', h.is_demo);
end $$;

-- the platform admin's link panel also learns whether the public demo is on
create or replace function public.padh_admin_qr_get(p_admin uuid, p_restaurant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.hotel_settings;
begin
  perform private.require_admin(p_admin);
  select * into h from public.hotel_settings where restaurant_id = p_restaurant;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  return jsonb_build_object('enabled', h.enabled, 'slug', (select slug from public.restaurants where id = p_restaurant),
                            'enc', case when h.qr_key_enc is null then null else encode(h.qr_key_enc, 'hex') end, 'rotated_at', h.qr_key_rotated_at, 'is_demo', h.is_demo);
end $$;

-- 0031_padharosaa_guest_app
-- What the guest app and the desk need beyond login and requests: the home boxes (today's offer, information note), stay info (Wi-Fi,
-- check-out, breakfast), a one-call "home" bootstrap, request tracking for the guest, and the desk's board.
-- The Wi-Fi password is encrypted by the app (AES-GCM) before it reaches the database and is decrypted only for a logged-in guest.
-- Idempotent. Rollback: drop the functions and the columns below.

alter table public.hotel_settings
  add column if not exists offer_text     text check (offer_text is null or char_length(offer_text) <= 200),
  add column if not exists offer_until    timestamptz,
  add column if not exists info_text      text check (info_text is null or char_length(info_text) <= 400),
  add column if not exists checkout_time  text check (checkout_time is null or char_length(checkout_time) <= 40),
  add column if not exists breakfast_text text check (breakfast_text is null or char_length(breakfast_text) <= 80);
grant select (offer_text, offer_until, info_text, checkout_time, breakfast_text) on public.hotel_settings to authenticated;

-- owner / manager: the two boxes on the guests' home screen. An offer must end within 7 days.
create or replace function public.padh_set_home(p_offer text, p_offer_until timestamptz, p_info text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
  v_offer text := nullif(private.clean_text(p_offer), ''); v_info text := nullif(private.clean_text(p_info), '');
begin
  if (v_offer is not null and char_length(v_offer) > 200) or (v_info is not null and char_length(v_info) > 400)
     or (v_offer is not null and (p_offer_until is null or p_offer_until <= now() or p_offer_until > now() + interval '7 days')) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.hotel_settings set offer_text = v_offer, offer_until = case when v_offer is null then null else p_offer_until end,
         info_text = v_info, updated_at = now() where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_home_updated', 'hotel_settings', v_rid::text, jsonb_build_object('offer', v_offer is not null, 'info', v_info is not null));
end $$;

-- owner / manager: stay info. p_wifi_enc is the already-encrypted password (null keeps the current one).
create or replace function public.padh_set_stay(p_wifi_name text, p_wifi_enc bytea, p_checkout text, p_breakfast text, p_reception_phone text, p_manager_phone text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  begin
    update public.hotel_settings
       set wifi_name = nullif(private.clean_text(p_wifi_name), ''), wifi_password_enc = coalesce(p_wifi_enc, wifi_password_enc),
           checkout_time = nullif(private.clean_text(p_checkout), ''), breakfast_text = nullif(private.clean_text(p_breakfast), ''),
           reception_phone = nullif(p_reception_phone, ''), manager_phone = nullif(p_manager_phone, ''), updated_at = now()
     where restaurant_id = v_rid;
  exception when check_violation then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  perform private.write_audit(v_rid, 'padh_stay_updated', 'hotel_settings', v_rid::text, '{}'::jsonb);
end $$;

-- guest: stay info (the encrypted password goes back to the app, which decrypts it)
create or replace function public.padh_guest_stay(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  return jsonb_build_object('wifi_name', h.wifi_name, 'wifi_password_enc', case when h.wifi_password_enc is null then null else encode(h.wifi_password_enc, 'hex') end,
    'checkout_time', h.checkout_time, 'breakfast', h.breakfast_text, 'entrance_maps_url', h.entrance_maps_url, 'diet', s.diet, 'occasion', s.occasion);
end $$;

-- guest: everything the home screen needs in one call
create or replace function public.padh_guest_home(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings; r public.restaurants; b public.buffets; v_today date; v_open int;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  select * into r from public.restaurants where id = s.restaurant_id;
  begin v_today := (now() at time zone h.timezone)::date; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; end;
  select * into b from public.buffets where restaurant_id = s.restaurant_id and service_date = v_today;
  select count(*) into v_open from public.requests where session_id = s.id and status in ('received','accepted','preparing','ready');
  return jsonb_build_object(
    'offer', case when h.offer_text is not null and h.offer_until > now() then h.offer_text end,
    'info', h.info_text,
    'buffet', case when b.id is null then jsonb_build_object('set', false)
                   when b.mode = 'none' then jsonb_build_object('set', true, 'mode', 'none')
                   else jsonb_build_object('set', true, 'mode', b.mode, 'name', b.name, 'start', to_char(b.start_time, 'HH24:MI'), 'end', to_char(b.end_time, 'HH24:MI'), 'venue', b.venue) end,
    'open_requests', v_open,
    'links', jsonb_build_object('instagram_url', r.instagram_url, 'google_review_url', coalesce(h.review_link, r.review_url), 'tripadvisor_url', h.tripadvisor_url, 'menu_url', h.menu_url),
    'contacts', jsonb_build_object('reception', h.reception_phone, 'manager', h.manager_phone));
end $$;

-- guest: one of their own requests with its updates (the bot messages tied to it) and the time of each step
create or replace function public.padh_guest_get_request(p_session uuid, p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q public.requests;
begin
  select * into q from public.requests where id = p_request and session_id = p_session;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  return jsonb_build_object(
    'request', jsonb_build_object('id', q.id, 'type', q.type, 'team', q.team, 'label', q.label, 'detail', q.detail, 'urgent', q.urgent, 'status', q.status,
      'dismissed_reason', q.dismissed_reason, 'resolution', q.resolution, 'handover', q.handover, 'prep_minutes', q.prep_minutes, 'est_ready_at', q.est_ready_at,
      'created_at', q.created_at, 'accepted_at', q.accepted_at, 'completed_at', q.completed_at, 'followup_asked', q.followup_asked, 'version', q.version),
    'updates', coalesce((select jsonb_agg(jsonb_build_object('at', m.created_at, 'key', m.body, 'params', m.params, 'chips', m.chips) order by m.created_at, m.id)
                           from public.messages m where m.request_id = q.id and m.direction = 'bot'), '[]'::jsonb));
end $$;

create or replace function public.padh_guest_list_requests(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.guest_sessions where id = p_session and status = 'active') then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.type, 'label', q.label, 'status', q.status, 'created_at', q.created_at) order by q.created_at desc)
                     from (select * from public.requests where session_id = p_session order by created_at desc limit 30) q), '[]'::jsonb);
end $$;

-- desk: the live board for the staff member's team(s), with guest and room details. mobile_enc comes back encrypted for the app to decrypt.
create or replace function public.padh_staff_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']); v_role text := private.my_role();
begin
  return jsonb_build_object('role', v_role, 'requests', coalesce((
    select jsonb_agg(row_to_json(x) order by x.urgent desc, x.created_at desc) from (
      select q.id, q.type, q.team, q.label, q.detail, q.urgent, q.status, q.dismissed_reason, q.resolution, q.handover, q.prep_minutes, q.version, q.created_at, q.accepted_at, q.parent_request_id,
             rm.number as room, g.guest_name, g.diet, g.occasion, g.language, case when v_role = 'kitchen' then null else encode(g.mobile_enc, 'hex') end as mobile_enc, g.mobile_cc,
             (select count(*) from public.guest_sessions g2 where g2.restaurant_id = q.restaurant_id and g2.room_id = q.room_id and g2.status = 'active') as guests_in_room
        from public.requests q join public.rooms rm on rm.id = q.room_id join public.guest_sessions g on g.id = q.session_id
       where q.restaurant_id = v_rid and private.role_can_act(v_role, q.team)
         and (q.status in ('received','accepted','preparing','ready') or q.updated_at > now() - interval '12 hours')
       order by q.urgent desc, q.created_at desc limit 200) x), '[]'::jsonb));
end $$;

revoke all on function public.padh_set_home(text, timestamptz, text), public.padh_set_stay(text, bytea, text, text, text, text), public.padh_staff_board() from public, anon, service_role;
grant execute on function public.padh_set_home(text, timestamptz, text), public.padh_set_stay(text, bytea, text, text, text, text), public.padh_staff_board() to authenticated;
revoke all on function public.padh_guest_stay(uuid), public.padh_guest_home(uuid), public.padh_guest_get_request(uuid, uuid), public.padh_guest_list_requests(uuid) from public, anon, authenticated;
grant execute on function public.padh_guest_stay(uuid), public.padh_guest_home(uuid), public.padh_guest_get_request(uuid, uuid), public.padh_guest_list_requests(uuid) to service_role;

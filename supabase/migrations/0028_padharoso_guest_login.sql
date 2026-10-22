-- 0028_padharoso_guest_login
-- Guest entry: QR key check, login at four verification levels, session lifecycle, stay codes, contacts, staff session controls.
-- All guest functions are service_role only: the Next.js API hashes/encrypts the personal data and the cookie token BEFORE calling
-- (the database never sees a plaintext mobile number or session token). Staff functions are authenticated + role checked.
--
-- Security notes
--  * QR key: hotel_settings.qr_key_hash = sha256(key). Unknown slug, wrong key, disabled hotel and suspended hotel ALL give the same
--    error (GM002), so nothing reveals whether a hotel exists.
--  * Credential failures (unknown room, wrong stay code, blocked mobile) are RETURNED as {ok:false, code} instead of raised, because a
--    raised error would roll back the failure counter that throttles guessing.
--  * Strict/verified levels return the SAME result for "room not found" and "wrong code" (spec 7.4). Light/off say "unknown_room".
--  * Throttles (deviation from spec 6.4, explained): hotel Wi-Fi puts many honest guests behind one IP, so all attempts are limited at
--    60 per IP per 10 minutes, and guessing is limited by FAILURES: stay code 5 per IP+room and 20 per room per 15 minutes;
--    unknown-room guessing 30 per IP per 15 minutes.
--  * Stay codes are 4 digits, hashed with a per-row salt, shown once, and never reused for the same room within 30 days.
--  * Keys are made from gen_random_uuid() (CSPRNG): 64 hex characters, about 244 bits of entropy.
--  * Level 'verified' (WhatsApp/SMS one-time code) needs the notification provider (Phase 9); until then it is refused (GM024).
-- Idempotent. Rollback: drop the functions below, consent_log, private.on_duty_shift/hash_code.

create table if not exists public.consent_log (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  session_id    uuid,
  purpose       text not null check (purpose in ('stay_messages','post_stay_review','marketing')),
  granted       boolean not null,
  text_version  text not null check (char_length(text_version) between 1 and 40),
  ip_hash       text check (ip_hash is null or char_length(ip_hash) <= 128),
  created_at    timestamptz not null default now()
);
alter table public.consent_log enable row level security; -- no policy, no grant: written by functions, read by the platform only

-- ---------- helpers ----------
create or replace function private.hash_code(p_salt bytea, p_code text) returns bytea
language sql immutable set search_path = '' as $$ select sha256(p_salt || convert_to(p_code, 'UTF8')) $$;
revoke all on function private.hash_code(bytea, text) from public, anon, authenticated;

create or replace function private.rand_hex(p_bytes int) returns text
language sql volatile set search_path = '' as $$
  select left(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), p_bytes * 2)
$$;
revoke all on function private.rand_hex(int) from public, anon, authenticated;

-- the shift on duty at a moment, in the hotel's own time zone; handles shifts that cross midnight
create or replace function private.on_duty_shift(p_restaurant uuid, p_at timestamptz default now()) returns public.concierge_shifts
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_t time; s public.concierge_shifts;
begin
  select timezone into v_tz from public.hotel_settings where restaurant_id = p_restaurant;
  if v_tz is null then return null; end if;
  begin
    v_t := (p_at at time zone v_tz)::time;
  exception when others then
    v_t := (p_at at time zone 'Asia/Kolkata')::time;
  end;
  select * into s from public.concierge_shifts c
   where c.restaurant_id = p_restaurant
     and case when c.start_time < c.end_time then v_t >= c.start_time and v_t < c.end_time
              else v_t >= c.start_time or v_t < c.end_time end
   order by c.sort, c.start_time limit 1;
  return s;
end $$;
revoke all on function private.on_duty_shift(uuid, timestamptz) from public, anon, authenticated;

-- ---------- platform: switch a restaurant into a Padharoso hotel (service_role; admin id checked like the other admin_* functions) ----------
create or replace function public.padh_admin_enable_hotel(p_admin uuid, p_restaurant uuid, p_timezone text default 'Asia/Kolkata') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_key text := private.rand_hex(32);
begin
  perform private.require_admin(p_admin);
  if not exists (select 1 from public.restaurants where id = p_restaurant) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  insert into public.hotel_settings (restaurant_id, timezone, qr_key_hash)
  values (p_restaurant, p_timezone, sha256(convert_to(v_key, 'UTF8')))
  on conflict (restaurant_id) do update
    set enabled = true, timezone = excluded.timezone,
        qr_key_hash = coalesce(public.hotel_settings.qr_key_hash, excluded.qr_key_hash), updated_at = now();
  -- the key is returned only when this call created it
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, p_admin, 'platform_admin', 'padharoso_enabled', 'hotel_settings', p_restaurant::text, '{}'::jsonb);
  return jsonb_build_object('restaurant_id', p_restaurant,
    'qr_key', case when (select qr_key_hash = sha256(convert_to(v_key, 'UTF8')) from public.hotel_settings where restaurant_id = p_restaurant)
                   then v_key end);
end $$;

-- ---------- public hotel info for the login page ----------
create or replace function public.padh_public_hotel(p_slug text, p_k text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; h public.hotel_settings;
begin
  select r2.* into r from public.restaurants r2 where r2.slug = p_slug;
  select * into h from public.hotel_settings where restaurant_id = r.id;
  if r.id is null or h.restaurant_id is null or not h.enabled or h.qr_key_hash is null or p_k is null or char_length(p_k) <> 64
     or h.qr_key_hash <> sha256(convert_to(p_k, 'UTF8')) or r.status <> 'active' or private.plan_expired(r) then
    raise exception using errcode = 'GM002', message = 'invalid_qr_key';
  end if;
  -- no phone numbers here: contacts are for logged-in guests only
  return jsonb_build_object('name', r.name, 'slug', r.slug, 'theme', h.theme, 'backdrop_mode', h.backdrop_mode,
    'backdrop_svg_path', h.backdrop_svg_path, 'verification_level', h.verification_level, 'languages', jsonb_build_array('en','hi','fr','es','de'),
    'is_mock', h.is_mock);
end $$;

-- ---------- guest login ----------
create or replace function public.padh_guest_login(
  p_slug text, p_k text, p_name text, p_cc text, p_mobile_enc bytea, p_mobile_hash bytea, p_language text, p_room text,
  p_stay_code text, p_token_hash bytea, p_resume_token_hash bytea, p_consent boolean, p_consent_version text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants; h public.hotel_settings; rm public.rooms; s public.guest_sessions;
  v_name text := private.clean_text(p_name);
  v_room text := upper(regexp_replace(btrim(coalesce(p_room, '')), '\s+', ' ', 'g'));
  v_ip text := coalesce(p_ip_hash, 'none');
  v_code_ok boolean := false;
  v_dummy_salt bytea := '\x00'::bytea;
  v_lang text := coalesce(p_language, 'en');
begin
  if char_length(v_name) not between 2 and 80 or p_cc is null or p_cc !~ '^\+[0-9]{1,3}$'
     or p_mobile_enc is null or p_mobile_hash is null or octet_length(p_mobile_hash) < 16
     or p_token_hash is null or octet_length(p_token_hash) <> 32
     or v_lang not in ('en','hi','fr','es','de') or v_room !~ '^[A-Z0-9][A-Z0-9 -]{0,9}$'
     or (p_stay_code is not null and p_stay_code !~ '^[0-9]{4}$') or (p_consent and (p_consent_version is null or char_length(p_consent_version) > 40)) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  select r2.* into r from public.restaurants r2 where r2.slug = p_slug;
  select * into h from public.hotel_settings where restaurant_id = r.id;
  if r.id is null or h.restaurant_id is null or not h.enabled or h.qr_key_hash is null or p_k is null or char_length(p_k) <> 64
     or h.qr_key_hash <> sha256(convert_to(p_k, 'UTF8')) or r.status <> 'active' or private.plan_expired(r) then
    raise exception using errcode = 'GM002', message = 'invalid_qr_key';
  end if;
  if h.verification_level = 'verified' then
    raise exception using errcode = 'GM024', message = 'verification_unavailable';
  end if;

  if not private.rl_hit('padh_login:' || r.id::text || ':' || v_ip, 60, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  select * into rm from public.rooms where restaurant_id = r.id and number = v_room and active;

  -- guessing locks (failure counters live in rate_limits; read-only check here, increments below)
  if h.verification_level = 'strict' then
    if not public.guest_rate_check('padh_code:' || r.id::text || ':' || v_ip || ':' || v_room, 5, 900)
       or not public.guest_rate_check('padh_coderoom:' || r.id::text || ':' || v_room, 20, 900) then
      return jsonb_build_object('ok', false, 'code', 'locked');
    end if;
  elsif not public.guest_rate_check('padh_enum:' || r.id::text || ':' || v_ip, 30, 900) then
    return jsonb_build_object('ok', false, 'code', 'locked');
  end if;

  if h.verification_level = 'strict' then
    if p_stay_code is not null then
      -- always do one hash comparison so a missing room costs the same as a wrong code
      select exists (select 1 from public.stay_codes c
                      where c.restaurant_id = r.id and c.room_id = coalesce(rm.id, '00000000-0000-0000-0000-000000000000'::uuid)
                        and c.valid_from <= now() and (c.valid_until is null or c.valid_until > now())
                        and c.code_hash = private.hash_code(c.salt, p_stay_code)) into v_code_ok;
      perform private.hash_code(v_dummy_salt, p_stay_code);
    end if;
    if rm.id is null or not v_code_ok then
      perform public.guest_rate_hit('padh_code:' || r.id::text || ':' || v_ip || ':' || v_room, 900);
      perform public.guest_rate_hit('padh_coderoom:' || r.id::text || ':' || v_room, 900);
      return jsonb_build_object('ok', false, 'code', 'login_failed');
    end if;
  elsif rm.id is null then
    perform public.guest_rate_hit('padh_enum:' || r.id::text || ':' || v_ip, 900);
    return jsonb_build_object('ok', false, 'code', 'unknown_room');
  end if;

  -- a mobile blocked by staff during the last 30 days cannot start a new session
  if exists (select 1 from public.guest_sessions g where g.restaurant_id = r.id and g.mobile_hash = p_mobile_hash
                and g.status = 'blocked' and g.last_seen_at > now() - interval '30 days') then
    return jsonb_build_object('ok', false, 'code', 'login_failed');
  end if;

  -- same device coming back (its cookie still matches an active session for this room and mobile): resume, no new row
  if p_resume_token_hash is not null then
    select * into s from public.guest_sessions g
     where g.restaurant_id = r.id and g.token_hash = p_resume_token_hash and g.status = 'active'
       and g.room_id = rm.id and g.mobile_hash = p_mobile_hash;
    if found then
      update public.guest_sessions set last_seen_at = now(), language = v_lang where id = s.id;
      return jsonb_build_object('ok', true, 'resumed', true, 'session_id', s.id, 'restaurant_id', r.id, 'language', v_lang);
    end if;
  end if;

  -- at most 3 live sessions per mobile number: the oldest is ended
  update public.guest_sessions set status = 'ended', ended_at = now()
   where id in (select g.id from public.guest_sessions g where g.restaurant_id = r.id and g.mobile_hash = p_mobile_hash and g.status = 'active'
                 order by g.started_at desc offset 2);

  insert into public.guest_sessions (restaurant_id, room_id, guest_name, mobile_cc, mobile_enc, mobile_hash, language, token_hash,
                                     verification, consent_messaging, consent_at)
  values (r.id, rm.id, v_name, p_cc, p_mobile_enc, p_mobile_hash, v_lang, p_token_hash,
          case when h.verification_level = 'strict' then 'code' else 'none' end, coalesce(p_consent, false),
          case when p_consent then now() end)
  returning * into s;

  if p_consent then
    insert into public.consent_log (restaurant_id, session_id, purpose, granted, text_version, ip_hash)
    values (r.id, s.id, 'stay_messages', true, p_consent_version, p_ip_hash);
  end if;

  perform private.bot_say(r.id, s.id, 'chat.welcome',
    jsonb_build_object('name', split_part(v_name, ' ', 1), 'hotel', r.name, 'room', rm.number), null,
    '["dining","plan_my_day","reservations","jaipur_guide"]'::jsonb);
  return jsonb_build_object('ok', true, 'resumed', false, 'session_id', s.id, 'restaurant_id', r.id, 'language', v_lang);
end $$;

-- ---------- every guest API call: cookie hash -> live session (applies expiry rules) ----------
-- Always returns {ok:true, ...session} or {ok:false[, expired:true]}; it never raises for a closed session.
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
    -- returned, not raised: a raised error would roll this status change back
    update public.guest_sessions set status = 'expired', ended_at = now() where id = s.id;
    return jsonb_build_object('ok', false, 'expired', true);
  end if;
  if s.last_seen_at < now() - interval '1 minute' then
    update public.guest_sessions set last_seen_at = now() where id = s.id;
  end if;
  select * into rm from public.rooms where id = s.room_id;
  return jsonb_build_object('ok', true, 'session_id', s.id, 'restaurant_id', s.restaurant_id, 'room', rm.number, 'name', s.guest_name,
    'language', s.language, 'diet', s.diet, 'occasion', s.occasion, 'hotel_name', r.name, 'slug', r.slug, 'theme', h.theme,
    'verification_level', h.verification_level, 'timezone', h.timezone);
end $$;

create or replace function public.padh_guest_logout(p_session uuid) returns void
language sql security definer set search_path = '' as $$
  update public.guest_sessions set status = 'ended', ended_at = now() where id = p_session and status = 'active'
$$;

-- ---------- contacts (only for a live session; never on the public page) ----------
create or replace function public.padh_guest_contacts(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings; sh public.concierge_shifts;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  sh := private.on_duty_shift(s.restaurant_id);
  return jsonb_build_object('reception', h.reception_phone, 'manager', h.manager_phone,
    'concierge', case when sh.id is not null then jsonb_build_object('name', sh.staff_name, 'mobile', sh.staff_mobile, 'shift', sh.label) end);
end $$;

create or replace function public.padh_guest_set_preferences(p_session uuid, p_diet text, p_occasion text, p_language text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (p_diet is not null and p_diet not in ('vegetarian','jain','vegan','non_vegetarian'))
     or (p_occasion is not null and p_occasion not in ('birthday','anniversary','honeymoon'))
     or (p_language is not null and p_language not in ('en','hi','fr','es','de')) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.guest_sessions set diet = p_diet, occasion = p_occasion, language = coalesce(p_language, language)
   where id = p_session and status = 'active';
  if not found then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;
end $$;

-- ---------- staff: QR key, stay codes, ending/blocking sessions, check-out ----------
create or replace function private.require_hotel_staff(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(p_roles);
begin
  if not private.is_hotel(v_rid) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return v_rid;
end $$;
revoke all on function private.require_hotel_staff(text[]) from public, anon, authenticated;

-- returns the NEW key once; the old QR codes stop working at once. Needs the typed confirmation "ROTATE".
create or replace function public.padh_rotate_qr_key(p_confirm text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_key text := private.rand_hex(32);
begin
  if p_confirm is distinct from 'ROTATE' then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.hotel_settings set qr_key_hash = sha256(convert_to(v_key, 'UTF8')), qr_key_rotated_at = now(), updated_at = now()
   where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_qr_rotated', 'hotel_settings', v_rid::text, '{}'::jsonb);
  return jsonb_build_object('qr_key', v_key);
end $$;

-- a new 4-digit code for a room; the previous code stops working; never repeats a code used in the last 30 days for that room
create or replace function public.padh_issue_stay_code(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
  rm public.rooms; v_code text; v_salt bytea; i int := 0;
begin
  select * into rm from public.rooms where id = p_room and restaurant_id = v_rid and active;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if not private.rl_hit('padh_issue:' || v_rid::text, 120, 3600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;
  loop
    i := i + 1;
    if i > 80 then
      raise exception using errcode = 'GM006', message = 'limit_exceeded';
    end if;
    v_code := lpad((abs(('x' || left(replace(gen_random_uuid()::text, '-', ''), 8))::bit(32)::bigint) % 10000)::text, 4, '0');
    exit when not exists (select 1 from public.stay_codes c where c.restaurant_id = v_rid and c.room_id = rm.id
                            and c.created_at > now() - interval '30 days' and c.code_hash = private.hash_code(c.salt, v_code));
  end loop;
  v_salt := decode(left(replace(gen_random_uuid()::text, '-', ''), 32), 'hex');
  update public.stay_codes set valid_until = now() where restaurant_id = v_rid and room_id = rm.id and (valid_until is null or valid_until > now());
  insert into public.stay_codes (restaurant_id, room_id, code_hash, salt, created_by)
  values (v_rid, rm.id, private.hash_code(v_salt, v_code), v_salt, auth.uid());
  perform private.write_audit(v_rid, 'padh_stay_code_issued', 'rooms', rm.id::text, jsonb_build_object('room', rm.number));
  return jsonb_build_object('room', rm.number, 'code', v_code);
end $$;

create or replace function public.padh_end_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
begin
  update public.guest_sessions set status = 'ended', ended_at = now() where id = p_session and restaurant_id = v_rid and status = 'active';
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  perform private.write_audit(v_rid, 'padh_session_ended', 'guest_sessions', p_session::text, '{}'::jsonb);
end $$;

create or replace function public.padh_block_session(p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
begin
  update public.guest_sessions set status = 'blocked', ended_at = now()
   where id = p_session and restaurant_id = v_rid and status in ('active','ended','expired');
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  perform private.write_audit(v_rid, 'padh_session_blocked', 'guest_sessions', p_session::text, '{}'::jsonb);
end $$;

-- check-out: ends every live session in the room and retires its stay code
create or replace function public.padh_checkout_room(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); v_n int;
begin
  if not exists (select 1 from public.rooms where id = p_room and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  update public.guest_sessions set status = 'ended', ended_at = now() where restaurant_id = v_rid and room_id = p_room and status = 'active';
  get diagnostics v_n = row_count;
  update public.stay_codes set valid_until = now() where restaurant_id = v_rid and room_id = p_room and (valid_until is null or valid_until > now());
  perform private.write_audit(v_rid, 'padh_room_checkout', 'rooms', p_room::text, jsonb_build_object('sessions_ended', v_n));
  return jsonb_build_object('sessions_ended', v_n);
end $$;

-- ---------- grants ----------
revoke all on function public.padh_admin_enable_hotel(uuid, uuid, text), public.padh_public_hotel(text, text),
  public.padh_guest_login(text, text, text, text, bytea, bytea, text, text, text, bytea, bytea, boolean, text, text),
  public.padh_guest_resolve_session(bytea), public.padh_guest_logout(uuid), public.padh_guest_contacts(uuid),
  public.padh_guest_set_preferences(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.padh_admin_enable_hotel(uuid, uuid, text), public.padh_public_hotel(text, text),
  public.padh_guest_login(text, text, text, text, bytea, bytea, text, text, text, bytea, bytea, boolean, text, text),
  public.padh_guest_resolve_session(bytea), public.padh_guest_logout(uuid), public.padh_guest_contacts(uuid),
  public.padh_guest_set_preferences(uuid, text, text, text) to service_role;

revoke all on function public.padh_rotate_qr_key(text), public.padh_issue_stay_code(uuid), public.padh_end_session(uuid),
  public.padh_block_session(uuid), public.padh_checkout_room(uuid) from public, anon, service_role;
grant execute on function public.padh_rotate_qr_key(text), public.padh_issue_stay_code(uuid), public.padh_end_session(uuid),
  public.padh_block_session(uuid), public.padh_checkout_room(uuid) to authenticated;

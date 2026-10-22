-- 0032_padharosaa_dining_staff
-- Dining decision (room delivery vs takeaway), staff directory (department, WhatsApp, head), per-person alert mutes,
-- guest food + categorised problem requests, and WhatsApp alert routing through the existing notifications outbox.
-- Nothing here sends a message: rows are queued in public.notifications for a delivery worker (docs/PRODUCTION.md).
-- Idempotent. Rollback: drop the functions below, then staff_alert_prefs, staff_profiles, and the added columns.

alter table public.hotel_settings add column if not exists room_dining boolean not null default true;
alter table public.requests add column if not exists notify_team text
  check (notify_team is null or notify_team in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager'));
grant select (room_dining) on public.hotel_settings to authenticated;
grant select (notify_team) on public.requests to authenticated;

-- ---------- staff directory ----------
create table if not exists public.staff_profiles (
  user_id       uuid primary key references public.staff(user_id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  department    text not null check (department in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager')),
  whatsapp      text check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  is_head       boolean not null default false,
  updated_at    timestamptz not null default now()
);
create index if not exists staff_profiles_dept_idx on public.staff_profiles (restaurant_id, department) where is_head;
create table if not exists public.staff_alert_prefs (
  user_id       uuid not null references public.staff(user_id) on delete cascade,
  team          text not null check (team in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager')),
  muted         boolean not null default true,
  primary key (user_id, team)
);
alter table public.staff_profiles enable row level security;
alter table public.staff_alert_prefs enable row level security;
-- no direct client access: both are read and written through the functions below
revoke all on public.staff_profiles, public.staff_alert_prefs from anon, authenticated;

-- ---------- manager: dining switch ----------
create or replace function public.padh_set_dining(p_room_dining boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  if not private.is_hotel(v_rid) then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  if p_room_dining is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.hotel_settings set room_dining = p_room_dining where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_dining_set', 'hotel_settings', v_rid::text, jsonb_build_object('room_dining', p_room_dining));
  return jsonb_build_object('room_dining', p_room_dining);
end $$;

-- ---------- kitchen / manager: how will this food order reach the guest? ----------
create or replace function public.padh_set_handover(p_request uuid, p_version int, p_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.requests; h public.hotel_settings;
begin
  if p_mode is null or p_mode not in ('deliver','takeaway') then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  q := private.lock_request(p_request, p_version, array['owner','manager','waiter','kitchen']);
  if q.type <> 'food' or q.status not in ('received','accepted','preparing','ready') then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  select * into h from public.hotel_settings where restaurant_id = q.restaurant_id;
  if p_mode = 'deliver' and not h.room_dining then
    raise exception using errcode = 'GM015', message = 'invalid_input'; -- this hotel has no room dining
  end if;
  update public.requests set handover = p_mode, version = version + 1, updated_at = now() where id = q.id returning * into q;
  perform private.req_event(q, 'staff', auth.uid(), 'handover', jsonb_build_object('mode', p_mode));
  perform private.bot_say(q.restaurant_id, q.session_id, case p_mode when 'deliver' then 'msg.handover_deliver' else 'msg.handover_takeaway' end,
    jsonb_build_object('label', q.label), q.id);
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'handover', q.handover, 'version', q.version);
end $$;

-- ---------- guest: food order request (the order itself lives in the restaurant's own menu page) ----------
create or replace function public.padh_guest_create_food(p_session uuid, p_label text, p_detail text, p_idem text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.guest_sessions; q public.requests; v_label text := private.clean_text(p_label); v_detail text := nullif(private.clean_text(p_detail), '');
begin
  if char_length(v_label) not between 1 and 120 or (v_detail is not null and char_length(v_detail) > 500) or p_idem is null or char_length(p_idem) not between 8 and 64 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into s from public.guest_sessions where id = p_session;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if s.status <> 'active' or not private.is_hotel(s.restaurant_id)
     or not exists (select 1 from public.restaurants r where r.id = s.restaurant_id and r.status = 'active') then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;
  select * into q from public.requests where restaurant_id = s.restaurant_id and idempotency_key = p_idem;
  if found then
    if q.session_id <> s.id then raise exception using errcode = 'GM012', message = 'not_found'; end if;
    return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version, 'replayed', true);
  end if;
  if not private.rl_hit('padh_req:' || s.id::text, 10, 300) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  insert into public.requests (restaurant_id, session_id, room_id, type, team, label, detail, idempotency_key)
  values (s.restaurant_id, s.id, s.room_id, 'food', 'kitchen', v_label, v_detail, p_idem) returning * into q;
  perform private.req_event(q, 'guest', null, 'created', jsonb_build_object('type', 'food'));
  perform private.bot_say(q.restaurant_id, s.id, 'msg.sent', '{}'::jsonb, q.id);
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version);
end $$;

-- ---------- queue WhatsApp alerts for a problem (heads of the chosen team and of reception, minus anyone who muted that team) ----------
create or replace function private.enqueue_help_alerts(q public.requests, p_room text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with targets as (
    select distinct p.user_id from public.staff_profiles p join public.staff s on s.user_id = p.user_id and s.active
     where p.restaurant_id = q.restaurant_id and p.is_head and p.whatsapp is not null
       and p.department in (coalesce(q.notify_team, 'front_desk'), 'front_desk')
       and not exists (select 1 from public.staff_alert_prefs a where a.user_id = p.user_id and a.team = coalesce(q.notify_team, 'front_desk') and a.muted))
  insert into public.notifications (restaurant_id, channel, to_ref, template, payload, dedupe_key)
  select q.restaurant_id, 'whatsapp', t.user_id::text, 'help_alert',
         jsonb_build_object('request_id', q.id, 'room', p_room, 'label', q.label, 'urgent', q.urgent), 'help:' || q.id || ':' || t.user_id
    from targets t on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.enqueue_help_alerts(public.requests, text) from public, anon, authenticated;

create or replace function public.padh_guest_create_help(p_session uuid, p_category text, p_detail text, p_urgent boolean, p_idem text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  out jsonb; q public.requests; v_team text; v_label text; v_room text;
begin
  select case p_category when 'ac_electrical' then 'maintenance' when 'water_plumbing' then 'maintenance' when 'cleanliness' then 'housekeeping'
                         when 'noise' then 'front_desk' when 'other' then 'front_desk' end,
         case p_category when 'ac_electrical' then 'AC or electrical' when 'water_plumbing' then 'Water or plumbing' when 'cleanliness' then 'Cleanliness'
                         when 'noise' then 'Noise' when 'other' then 'Something else' end into v_team, v_label;
  if v_team is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  out := public.padh_guest_create_request(p_session, 'help', v_label, p_detail, p_urgent, p_idem);
  if (out ->> 'replayed') is null and (out ->> 'merged') is null then
    update public.requests set notify_team = v_team where id = (out ->> 'request_id')::uuid returning * into q;
    select number into v_room from public.rooms where id = q.room_id;
    perform private.enqueue_help_alerts(q, v_room);
  end if;
  return out;
end $$;

-- ---------- manager: staff directory ----------
create or replace function public.padh_staff_directory() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', u.email, 'name', s.display_name, 'role', s.role, 'active', s.active,
                    'department', p.department, 'whatsapp', p.whatsapp, 'is_head', coalesce(p.is_head, false))
                    order by s.display_name)
                   from public.staff s join auth.users u on u.id = s.user_id left join public.staff_profiles p on p.user_id = s.user_id
                  where s.restaurant_id = v_rid), '[]'::jsonb);
end $$;

create or replace function public.padh_staff_profile_set(p_user uuid, p_department text, p_whatsapp text, p_is_head boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); v_wa text := nullif(regexp_replace(coalesce(p_whatsapp, ''), '[ -]', '', 'g'), '');
begin
  if not private.is_hotel(v_rid) then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  if p_department is null or p_department not in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager')
     or (v_wa is not null and v_wa !~ '^\+[1-9][0-9]{7,14}$') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.staff where user_id = p_user and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  insert into public.staff_profiles (user_id, restaurant_id, department, whatsapp, is_head)
  values (p_user, v_rid, p_department, v_wa, coalesce(p_is_head, false))
  on conflict (user_id) do update set department = excluded.department, whatsapp = excluded.whatsapp, is_head = excluded.is_head, updated_at = now();
  perform private.write_audit(v_rid, 'padh_staff_profile_set', 'staff_profiles', p_user::text, jsonb_build_object('department', p_department, 'head', coalesce(p_is_head, false)));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- every staff member: their own alert mutes ----------
create or replace function public.padh_my_alerts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']); v_role text := private.my_role();
begin
  return jsonb_build_object('room_dining', (select room_dining from public.hotel_settings where restaurant_id = v_rid),
    'muted', coalesce((select jsonb_agg(a.team) from public.staff_alert_prefs a where a.user_id = auth.uid() and a.muted), '[]'::jsonb),
    'teams', (select jsonb_agg(t) from unnest(array['concierge','front_desk','housekeeping','kitchen','maintenance','manager']) t where private.role_can_act(v_role, t)));
end $$;

create or replace function public.padh_set_my_alert(p_team text, p_muted boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']);
begin
  if p_team is null or p_muted is null or p_team not in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not private.role_can_act(private.my_role(), p_team) then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  insert into public.staff_alert_prefs (user_id, team, muted) values (auth.uid(), p_team, p_muted)
  on conflict (user_id, team) do update set muted = excluded.muted;
  return jsonb_build_object('team', p_team, 'muted', p_muted);
end $$;

revoke all on function public.padh_set_dining(boolean), public.padh_set_handover(uuid, int, text), public.padh_staff_directory(),
  public.padh_staff_profile_set(uuid, text, text, boolean), public.padh_my_alerts(), public.padh_set_my_alert(text, boolean) from public, anon, service_role;
grant execute on function public.padh_set_dining(boolean), public.padh_set_handover(uuid, int, text), public.padh_staff_directory(),
  public.padh_staff_profile_set(uuid, text, text, boolean), public.padh_my_alerts(), public.padh_set_my_alert(text, boolean) to authenticated;
revoke all on function public.padh_guest_create_food(uuid, text, text, text), public.padh_guest_create_help(uuid, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.padh_guest_create_food(uuid, text, text, text), public.padh_guest_create_help(uuid, text, text, boolean, text) to service_role;

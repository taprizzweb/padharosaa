-- 0027_padharoso_requests
-- Padharoso request lifecycle: requests, request_events (append-only), messages (guest chat), and the state machine.
-- Every change goes through the functions below (staff: authenticated; guest: service_role, called by the API after it has
-- verified the guest's cookie). There are no direct client writes on any of these tables.
--
-- State machine (spec 3.4):  received -> accepted -> completed
--   side exits: dismissed (reason required), cancelled (guest, only while received), expired (system, later)
--   food adds accepted -> preparing -> ready -> completed (driven by the kitchen functions in the dining slice)
-- Concurrency: every staff transition carries the `version` the screen saw; a mismatch raises GM019 (conflict).
-- Messages store an i18n KEY in `body` plus `params`, so the guest's phone renders them in the guest's language.
-- Idempotent. Rollback: drop the functions below, then messages, request_events, requests (in that order).

-- ---------- helpers ----------
-- strip control characters and bidirectional overrides (spec 7.6), collapse whitespace, trim
create or replace function private.clean_text(p_text text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
           regexp_replace(coalesce(p_text, ''), '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F‪-‮⁦-⁩]', '', 'g'),
           '[ \t]+', ' ', 'g'))
$$;
revoke all on function private.clean_text(text) from public, anon, authenticated;

-- default routing (spec 3.4)
create or replace function private.default_team(p_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_type
    when 'food' then 'kitchen'
    when 'housekeeping' then 'housekeeping'
    when 'help' then 'front_desk'
    when 'wake' then 'front_desk' when 'late_checkout' then 'front_desk' when 'checkout' then 'front_desk'
    when 'feedback_alert' then 'manager'
    else 'concierge' end
$$;
revoke all on function private.default_team(text) from public, anon, authenticated;

-- may this staff role act on a request of this team?  owner/manager: all; waiter (reception/concierge): all; kitchen: kitchen only
create or replace function private.role_can_act(p_role text, p_team text) returns boolean
language sql immutable set search_path = '' as $$
  select case when p_role in ('owner','manager','waiter') then true
              when p_role = 'kitchen' then p_team = 'kitchen'
              else false end
$$;
-- RLS policies run as the caller, so the caller needs EXECUTE on this pure function
revoke all on function private.role_can_act(text, text) from public, anon;
grant execute on function private.role_can_act(text, text) to authenticated;

-- ---------- tables ----------
create table if not exists public.requests (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  session_id       uuid not null,
  room_id          uuid not null,
  type             text not null check (type in ('food','housekeeping','wake','cab','late_checkout','reservation','skip_line','artisan',
                                                 'errand','plan','checkout','help','feedback_alert','chat_message','vista')),
  team             text not null check (team in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager')),
  label            text not null check (char_length(label) between 1 and 120),
  detail           text check (detail is null or char_length(detail) <= 500),
  urgent           boolean not null default false,
  status           text not null default 'received'
                   check (status in ('received','accepted','preparing','ready','completed','dismissed','cancelled','expired')),
  dismissed_reason text check (dismissed_reason is null or char_length(dismissed_reason) between 3 and 140),
  resolution       text check (resolution is null or resolution in ('fixed','replacement_sent','room_changed','compensation_offered')),
  parent_request_id uuid references public.requests(id),
  order_id         uuid,
  prep_minutes     int check (prep_minutes is null or prep_minutes between 1 and 180),
  est_ready_at     timestamptz,
  handover         text check (handover in ('takeaway','deliver')),
  payment_method   text check (payment_method in ('room_bill','upi','cash','card')),
  idempotency_key  text check (idempotency_key is null or char_length(idempotency_key) between 8 and 64),
  version          int not null default 1,
  accepted_by      uuid references auth.users(id),
  accepted_at      timestamptz,
  completed_at     timestamptz,
  followup_asked   boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (session_id, restaurant_id) references public.guest_sessions (id, restaurant_id) on delete cascade,
  foreign key (room_id, restaurant_id) references public.rooms (id, restaurant_id),
  unique (id, restaurant_id),
  unique (restaurant_id, idempotency_key)
);
create index if not exists requests_hotel_status_idx on public.requests (restaurant_id, status, created_at desc);
create index if not exists requests_session_idx on public.requests (session_id, created_at desc);

create table if not exists public.request_events (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null,
  request_id    uuid not null,
  actor_type    text not null check (actor_type in ('guest','staff','system')),
  actor_id      uuid,
  action        text not null check (char_length(action) between 1 and 40),
  data          jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  foreign key (request_id, restaurant_id) references public.requests (id, restaurant_id) on delete cascade
);
create index if not exists request_events_req_idx on public.request_events (request_id, id);

create table if not exists public.messages (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  session_id    uuid not null,
  direction     text not null check (direction in ('bot','guest','staff','system')),
  kind          text not null check (kind in ('bot_text','bot_card','guest_text','guest_chip_echo','system_notice','staff_text')),
  body          text check (body is null or char_length(body) <= 600), -- an i18n key for bot/system messages, free text for guest/staff
  params        jsonb not null default '{}'::jsonb,
  card          jsonb,
  chips         jsonb,
  chip_used     int,
  request_id    uuid,
  created_at    timestamptz not null default now(),
  foreign key (session_id, restaurant_id) references public.guest_sessions (id, restaurant_id) on delete cascade,
  foreign key (request_id, restaurant_id) references public.requests (id, restaurant_id) on delete set null (request_id)
);
create index if not exists messages_session_idx on public.messages (session_id, created_at, id);

-- ---------- RLS + grants (read only) ----------
alter table public.requests       enable row level security;
alter table public.request_events enable row level security;
alter table public.messages       enable row level security;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
         and private.role_can_act((select private.my_role()), team));

drop policy if exists request_events_select on public.request_events;
create policy request_events_select on public.request_events for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
         and exists (select 1 from public.requests q
                      where q.id = request_events.request_id and q.restaurant_id = request_events.restaurant_id
                        and private.role_can_act((select private.my_role()), q.team)));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
         and (select private.my_role()) in ('owner','manager','waiter'));

grant select (id, restaurant_id, session_id, room_id, type, team, label, detail, urgent, status, dismissed_reason, resolution,
              parent_request_id, order_id, prep_minutes, est_ready_at, handover, payment_method, version, accepted_by, accepted_at,
              completed_at, created_at, updated_at)
  on public.requests to authenticated;
grant select on public.request_events, public.messages to authenticated;

-- realtime for staff screens (RLS filters every event); no-op when the publication does not exist
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['requests','messages'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------- internal writers ----------
create or replace function private.req_event(p_req public.requests, p_actor_type text, p_actor uuid, p_action text, p_data jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.request_events (restaurant_id, request_id, actor_type, actor_id, action, data)
  values (p_req.restaurant_id, p_req.id, p_actor_type, p_actor, p_action, coalesce(p_data, '{}'::jsonb))
$$;
revoke all on function private.req_event(public.requests, text, uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.bot_say(p_restaurant uuid, p_session uuid, p_key text, p_params jsonb, p_request uuid default null, p_chips jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.messages (restaurant_id, session_id, direction, kind, body, params, request_id, chips)
  values (p_restaurant, p_session, 'bot', 'bot_text', p_key, coalesce(p_params, '{}'::jsonb), p_request, p_chips)
$$;
revoke all on function private.bot_say(uuid, uuid, text, jsonb, uuid, jsonb) from public, anon, authenticated;

-- loads and locks a request for a staff transition; checks hotel, role, team and the version the screen saw
create or replace function private.lock_request(p_request uuid, p_version int, p_roles text[])
returns public.requests language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(p_roles); q public.requests;
begin
  if not private.is_hotel(v_rid) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  select * into q from public.requests where id = p_request and restaurant_id = v_rid for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if not private.role_can_act(private.my_role(), q.team) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  if p_version is null or q.version <> p_version then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  return q;
end $$;
revoke all on function private.lock_request(uuid, int, text[]) from public, anon, authenticated;

create or replace function private.team_label(p_team text) returns text
language sql immutable set search_path = '' as $$
  select case p_team when 'front_desk' then 'Front desk' when 'concierge' then 'Concierge' when 'housekeeping' then 'Housekeeping'
                     when 'kitchen' then 'Kitchen' when 'maintenance' then 'Maintenance' else 'Manager' end
$$;
revoke all on function private.team_label(text) from public, anon, authenticated;

-- ---------- staff: accept ----------
create or replace function public.padh_accept(p_request uuid, p_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.requests;
begin
  q := private.lock_request(p_request, p_version, array['owner','manager','waiter','kitchen']);
  if q.status <> 'received' then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  update public.requests set status = 'accepted', accepted_by = auth.uid(), accepted_at = now(), version = version + 1, updated_at = now()
   where id = q.id returning * into q;
  perform private.req_event(q, 'staff', auth.uid(), 'accepted');
  perform private.bot_say(q.restaurant_id, q.session_id, 'msg.accepted',
    jsonb_build_object('team', private.team_label(q.team), 'at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'label', q.label), q.id);
  perform private.write_audit(q.restaurant_id, 'padh_request_accepted', 'requests', q.id::text, jsonb_build_object('type', q.type));
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version);
end $$;

-- ---------- staff: dismiss (reason is mandatory: a preset code or 3-140 characters of text) ----------
create or replace function public.padh_dismiss(p_request uuid, p_version int, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  q public.requests;
  v_reason text := private.clean_text(p_reason);
  v_presets text[] := array['not_available','not_offered','duplicate','slot_full','will_call'];
begin
  if char_length(v_reason) < 3 or char_length(v_reason) > 140 then
    raise exception using errcode = 'GM014', message = 'reason_required';
  end if;
  q := private.lock_request(p_request, p_version, array['owner','manager','waiter','kitchen']);
  if q.status not in ('received','accepted') then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  update public.requests set status = 'dismissed', dismissed_reason = v_reason, version = version + 1, updated_at = now()
   where id = q.id returning * into q;
  perform private.req_event(q, 'staff', auth.uid(), 'dismissed', jsonb_build_object('reason', v_reason));
  -- the guest is ALWAYS told, with the reason; the client translates preset codes
  perform private.bot_say(q.restaurant_id, q.session_id, 'msg.dismissed',
    jsonb_build_object('label', q.label, 'reason', v_reason, 'preset', v_reason = any (v_presets)), q.id,
    '["call_reception","chat_reception"]'::jsonb);
  perform private.write_audit(q.restaurant_id, 'padh_request_dismissed', 'requests', q.id::text, jsonb_build_object('type', q.type));
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version);
end $$;

-- ---------- staff: pass to another team ----------
create or replace function public.padh_pass(p_request uuid, p_version int, p_team text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.requests;
begin
  if p_team is null or p_team not in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  q := private.lock_request(p_request, p_version, array['owner','manager','waiter']);
  if q.status not in ('received','accepted') or q.team = p_team or q.type = 'food' then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  update public.requests set team = p_team, status = 'received', accepted_by = null, accepted_at = null, version = version + 1, updated_at = now()
   where id = q.id returning * into q;
  perform private.req_event(q, 'staff', auth.uid(), 'passed', jsonb_build_object('team', p_team));
  perform private.bot_say(q.restaurant_id, q.session_id, 'msg.passed', jsonb_build_object('team', private.team_label(p_team)), q.id);
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'team', q.team, 'version', q.version);
end $$;

-- ---------- staff: complete / confirm booking ----------
create or replace function public.padh_complete(p_request uuid, p_version int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.requests;
begin
  q := private.lock_request(p_request, p_version, array['owner','manager','waiter','kitchen']);
  if q.status not in ('accepted','ready') or q.type = 'help' then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  update public.requests set status = 'completed', completed_at = now(), version = version + 1, updated_at = now()
   where id = q.id returning * into q;
  perform private.req_event(q, 'staff', auth.uid(), 'completed');
  perform private.bot_say(q.restaurant_id, q.session_id, 'msg.completed', jsonb_build_object('label', q.label), q.id,
    '["anything_else"]'::jsonb);
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version);
end $$;

-- ---------- staff: resolve a help request (then the guest is asked "is everything okay now?") ----------
create or replace function public.padh_resolve(p_request uuid, p_version int, p_outcome text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.requests;
begin
  if p_outcome is null or p_outcome not in ('fixed','replacement_sent','room_changed','compensation_offered') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  q := private.lock_request(p_request, p_version, array['owner','manager','waiter']);
  if q.type <> 'help' or q.status not in ('received','accepted') then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  update public.requests set status = 'completed', resolution = p_outcome, completed_at = now(), version = version + 1, updated_at = now()
   where id = q.id returning * into q;
  perform private.req_event(q, 'staff', auth.uid(), 'resolved', jsonb_build_object('outcome', p_outcome));
  perform private.bot_say(q.restaurant_id, q.session_id, 'msg.resolved', jsonb_build_object('outcome', p_outcome), q.id,
    '["resolved_yes","resolved_no"]'::jsonb);
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version);
end $$;

-- ---------- guest (service_role only): create a request ----------
-- The API has already verified the guest's cookie and passes the session id. Food orders and system types are not creatable here.
create or replace function public.padh_guest_create_request(
  p_session uuid, p_type text, p_label text, p_detail text default null, p_urgent boolean default false, p_idem text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.guest_sessions;
  q public.requests;
  v_label text := private.clean_text(p_label);
  v_detail text := nullif(private.clean_text(p_detail), '');
  v_dup uuid;
begin
  if p_type is null or p_type not in ('housekeeping','wake','cab','late_checkout','reservation','skip_line','artisan','errand','plan','checkout','help')
     or char_length(v_label) not between 1 and 120 or (v_detail is not null and char_length(v_detail) > 500)
     or p_idem is null or char_length(p_idem) not between 8 and 64 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into s from public.guest_sessions where id = p_session;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if s.status <> 'active' or not private.is_hotel(s.restaurant_id)
     or not exists (select 1 from public.restaurants r where r.id = s.restaurant_id and r.status = 'active') then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;

  -- replay of the same idempotency key returns the original
  select * into q from public.requests where restaurant_id = s.restaurant_id and idempotency_key = p_idem;
  if found then
    if q.session_id <> s.id then
      raise exception using errcode = 'GM012', message = 'not_found';
    end if;
    return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version, 'replayed', true);
  end if;

  -- flood limit: 10 requests per session per 5 minutes
  if not private.rl_hit('padh_req:' || s.id::text, 10, 300) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  -- the same ask within 60 seconds is merged, unless the details differ
  select id into v_dup from public.requests
   where session_id = s.id and type = p_type and label = v_label and detail is not distinct from v_detail
     and status in ('received','accepted') and created_at > now() - interval '60 seconds'
   order by created_at desc limit 1;
  if v_dup is not null then
    select * into q from public.requests where id = v_dup;
    return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version, 'merged', true);
  end if;

  insert into public.requests (restaurant_id, session_id, room_id, type, team, label, detail, urgent, idempotency_key)
  values (s.restaurant_id, s.id, s.room_id, p_type, private.default_team(p_type), v_label, v_detail, coalesce(p_urgent, false), p_idem)
  returning * into q;
  perform private.req_event(q, 'guest', null, 'created', jsonb_build_object('type', q.type, 'urgent', q.urgent));
  perform private.bot_say(q.restaurant_id, s.id, case when p_type = 'help' then 'msg.sorry_problem' else 'msg.sent' end, '{}'::jsonb, q.id);
  update public.guest_sessions set last_seen_at = now() where id = s.id;
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version);
end $$;

-- ---------- guest: cancel (only while received) ----------
create or replace function public.padh_guest_cancel_request(p_session uuid, p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.requests;
begin
  select * into q from public.requests where id = p_request and session_id = p_session for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if q.status <> 'received' then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  update public.requests set status = 'cancelled', version = version + 1, updated_at = now() where id = q.id returning * into q;
  perform private.req_event(q, 'guest', null, 'cancelled');
  return jsonb_build_object('request_id', q.id, 'status', q.status, 'version', q.version);
end $$;

-- ---------- guest: "is everything okay now?"  No reopens as a NEW urgent request to the Manager, linked to the original ----------
create or replace function public.padh_guest_confirm_resolved(p_session uuid, p_request uuid, p_ok boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.requests; n public.requests;
begin
  select * into q from public.requests where id = p_request and session_id = p_session and type = 'help' for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if q.status <> 'completed' or q.resolution is null or q.followup_asked then
    raise exception using errcode = 'GM010', message = 'invalid_transition';
  end if;
  update public.requests set followup_asked = true, updated_at = now() where id = q.id;
  if coalesce(p_ok, false) then
    perform private.req_event(q, 'guest', null, 'confirmed_ok');
    perform private.bot_say(q.restaurant_id, q.session_id, 'chat.anything_else', '{}'::jsonb, q.id);
    return jsonb_build_object('request_id', q.id, 'escalated', false);
  end if;
  insert into public.requests (restaurant_id, session_id, room_id, type, team, label, detail, urgent, parent_request_id)
  values (q.restaurant_id, q.session_id, q.room_id, 'help', 'manager', q.label, q.detail, true, q.id)
  returning * into n;
  perform private.req_event(q, 'guest', null, 'not_resolved', jsonb_build_object('new_request', n.id));
  perform private.req_event(n, 'system', null, 'created', jsonb_build_object('reopened_from', q.id));
  perform private.bot_say(q.restaurant_id, q.session_id, 'msg.escalated', '{}'::jsonb, n.id);
  return jsonb_build_object('request_id', q.id, 'escalated', true, 'new_request_id', n.id);
end $$;

-- ---------- guest: read the chat (newest 50, or older than p_before) ----------
create or replace function public.padh_guest_list_messages(p_session uuid, p_before timestamptz default null, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not exists (select 1 from public.guest_sessions where id = p_session and status = 'active') then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc, m.id desc) from (
    select id, direction, kind, body, params, card, chips, chip_used, request_id, created_at
      from public.messages where session_id = p_session and (p_before is null or created_at < p_before)
     order by created_at desc, id desc limit v_lim) m), '[]'::jsonb);
end $$;

-- ---------- grants ----------
revoke all on function public.padh_accept(uuid, int), public.padh_dismiss(uuid, int, text), public.padh_pass(uuid, int, text),
  public.padh_complete(uuid, int), public.padh_resolve(uuid, int, text) from public, anon, service_role;
grant execute on function public.padh_accept(uuid, int), public.padh_dismiss(uuid, int, text), public.padh_pass(uuid, int, text),
  public.padh_complete(uuid, int), public.padh_resolve(uuid, int, text) to authenticated;

revoke all on function public.padh_guest_create_request(uuid, text, text, text, boolean, text), public.padh_guest_cancel_request(uuid, uuid),
  public.padh_guest_confirm_resolved(uuid, uuid, boolean), public.padh_guest_list_messages(uuid, timestamptz, int)
  from public, anon, authenticated;
grant execute on function public.padh_guest_create_request(uuid, text, text, text, boolean, text), public.padh_guest_cancel_request(uuid, uuid),
  public.padh_guest_confirm_resolved(uuid, uuid, boolean), public.padh_guest_list_messages(uuid, timestamptz, int) to service_role;

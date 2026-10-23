-- 0035_padharosaa_help_chips
-- Problem reports take SEVERAL chips (like the menu app's "Call for problems" sheet) plus an optional note.
-- Each chip belongs to a team; the request lands on reception's board, and the head of every chosen team (and of reception) is alerted.
-- Idempotent. Rollback: restore padh_guest_create_help(uuid,text,text,boolean,text) from 0032 and drop notify_teams.

alter table public.requests add column if not exists notify_teams text[] not null default '{}';
update public.requests set notify_teams = array[notify_team] where notify_team is not null and notify_teams = '{}';
do $$ begin
  alter table public.requests add constraint requests_notify_teams_valid check (notify_teams <@ array['concierge','front_desk','housekeeping','kitchen','maintenance','manager']);
exception when duplicate_object then null;
end $$;
grant select (notify_teams) on public.requests to authenticated;

create or replace function private.enqueue_help_alerts(q public.requests, p_room text) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with targets as (
    select distinct p.user_id from public.staff_profiles p join public.staff s on s.user_id = p.user_id and s.active
     where p.restaurant_id = q.restaurant_id and p.is_head and p.whatsapp is not null
       and (p.department = 'front_desk' or p.department = any (q.notify_teams))
       and not exists (select 1 from public.staff_alert_prefs a where a.user_id = p.user_id and a.team = p.department and a.muted))
  insert into public.notifications (restaurant_id, channel, to_ref, template, payload, dedupe_key)
  select q.restaurant_id, 'whatsapp', t.user_id::text, 'help_alert',
         jsonb_build_object('request_id', q.id, 'room', p_room, 'label', q.label, 'urgent', q.urgent), 'help:' || q.id || ':' || t.user_id
    from targets t on conflict (dedupe_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.enqueue_help_alerts(public.requests, text) from public, anon, authenticated;

drop function if exists public.padh_guest_create_help(uuid, text, text, boolean, text);
create or replace function public.padh_guest_create_help(p_session uuid, p_categories text[], p_detail text, p_urgent boolean, p_idem text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  out jsonb; q public.requests; v_room text; v_cats text[]; c text; v_labels text[] := '{}'; v_teams text[] := '{}'; v_label text; v_team text; v_detail text := nullif(private.clean_text(p_detail), '');
begin
  select coalesce(array_agg(distinct x), '{}') into v_cats from unnest(coalesce(p_categories, '{}')) x;
  if coalesce(array_length(v_cats, 1), 0) > 8 or (coalesce(array_length(v_cats, 1), 0) = 0 and (v_detail is null or char_length(v_detail) < 3)) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  foreach c in array v_cats loop
    select case c when 'towel_bedsheet' then 'housekeeping' when 'cleanliness' then 'housekeeping' when 'water' then 'maintenance' when 'wifi' then 'maintenance'
                  when 'ac_electrical' then 'maintenance' when 'tv' then 'maintenance' when 'noise' then 'front_desk' when 'other' then 'front_desk' end,
           case c when 'towel_bedsheet' then 'Towel or bedsheet' when 'cleanliness' then 'Cleanliness' when 'water' then 'Water not coming'
                  when 'wifi' then 'WiFi not working' when 'ac_electrical' then 'AC or electrical' when 'tv' then 'TV not working'
                  when 'noise' then 'Noise' when 'other' then 'Something else' end into v_team, v_label;
    if v_team is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
    v_labels := v_labels || v_label;
    if not v_team = any (v_teams) then v_teams := v_teams || v_team; end if;
  end loop;
  if array_length(v_labels, 1) is null then v_labels := array['Something else']; v_teams := array['front_desk']; end if;
  v_label := left(array_to_string(v_labels, ', '), 120);
  out := public.padh_guest_create_request(p_session, 'help', v_label, p_detail, p_urgent, p_idem);
  if (out ->> 'replayed') is null and (out ->> 'merged') is null then
    update public.requests set notify_teams = v_teams, notify_team = v_teams[1] where id = (out ->> 'request_id')::uuid returning * into q;
    select number into v_room from public.rooms where id = q.room_id;
    perform private.enqueue_help_alerts(q, v_room);
  end if;
  return out;
end $$;
revoke all on function public.padh_guest_create_help(uuid, text[], text, boolean, text) from public, anon, authenticated;
grant execute on function public.padh_guest_create_help(uuid, text[], text, boolean, text) to service_role;

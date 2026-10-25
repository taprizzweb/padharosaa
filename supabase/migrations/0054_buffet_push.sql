-- 0054_buffet_push
-- A phone notification (Web Push, works in Chrome and in a home-screen app on iPhone) to every guest who allowed it:
--   * the moment the desk or the manager saves TODAY'S buffet (switchable), and
--   * once more at a time the hotel chooses, every day (for example 6:30 PM), if today's buffet is set.
-- A guest's phone is stored on their own session (guest_sessions.push_subscription); a checked-out guest has no session, so no more messages.
-- Idempotent. Rollback: drop the five functions and the two columns, restore padh_buffet_list from 0039.
alter table public.hotel_settings add column if not exists buffet_notify_time time;
alter table public.hotel_settings add column if not exists buffet_notify_on_save boolean not null default true;

-- the guest's phone: store it, or clear it (null)
create or replace function public.padh_guest_set_push(p_session uuid, p_sub jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_sub is not null and (jsonb_typeof(p_sub) <> 'object' or coalesce(p_sub #>> '{endpoint}', '') !~ '^https://[^[:space:]]+$' or char_length(p_sub #>> '{endpoint}') not between 20 and 1000
     or char_length(coalesce(p_sub #>> '{keys,p256dh}', '')) not between 20 and 200 or char_length(coalesce(p_sub #>> '{keys,auth}', '')) not between 8 and 100) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.guest_sessions set push_subscription = p_sub where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
end $$;
revoke all on function public.padh_guest_set_push(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.padh_guest_set_push(uuid, jsonb) to service_role;

-- the phones to notify for one hotel (only guests who are still staying), and dropping a phone that no longer answers
create or replace function public.padh_push_targets(p_restaurant uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'sub', g.push_subscription)), '[]'::jsonb)
    from public.guest_sessions g where g.restaurant_id = p_restaurant and g.status = 'active' and g.push_subscription is not null
$$;
create or replace function public.padh_push_drop(p_session uuid) returns void
language sql security definer set search_path = '' as $$
  update public.guest_sessions set push_subscription = null where id = p_session
$$;
revoke all on function public.padh_push_targets(uuid), public.padh_push_drop(uuid) from public, anon, authenticated;
grant execute on function public.padh_push_targets(uuid), public.padh_push_drop(uuid) to service_role;

-- today's buffet of a hotel in words, for the message (null when there is none to announce)
create or replace function public.padh_buffet_today(p_restaurant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare h public.hotel_settings; r public.restaurants; b public.buffets; v_today date;
begin
  select * into h from public.hotel_settings where restaurant_id = p_restaurant and enabled;
  if not found then return null; end if;
  select * into r from public.restaurants where id = p_restaurant;
  begin v_today := (now() at time zone h.timezone)::date; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; end;
  select * into b from public.buffets where restaurant_id = p_restaurant and service_date = v_today;
  if not found or b.mode = 'none' then return null; end if;
  return jsonb_build_object('slug', r.slug, 'hotel', r.name, 'name', b.name, 'start', to_char(b.start_time, 'HH24:MI'), 'end', to_char(b.end_time, 'HH24:MI'), 'venue', b.venue);
end $$;
revoke all on function public.padh_buffet_today(uuid) from public, anon, authenticated;
grant execute on function public.padh_buffet_today(uuid) to service_role;

-- the hotel's choice: notify on save, and the daily reminder time (empty = no daily reminder). Desk, manager and owner
create or replace function public.padh_buffet_notify_set(p_time time, p_on_save boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
begin
  if p_on_save is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.hotel_settings set buffet_notify_time = p_time, buffet_notify_on_save = p_on_save where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_buffet_notify_set', 'hotel_settings', v_rid::text, jsonb_build_object('time', p_time, 'on_save', p_on_save));
  return jsonb_build_object('notify_time', to_char(p_time, 'HH24:MI'), 'notify_on_save', p_on_save);
end $$;
revoke all on function public.padh_buffet_notify_set(time, boolean) from public, anon, service_role;
grant execute on function public.padh_buffet_notify_set(time, boolean) to authenticated;

-- the daily reminders that are due now. A hotel is due from its reminder time until half an hour later, once per day (claimed here, so two
-- callers never send twice), and only if today's buffet is set. Returns what to say for each.
create or replace function public.padh_buffet_reminders_claim() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare h record; v_today date; v_now time; v_claim uuid; v_b jsonb; v_out jsonb := '[]'::jsonb;
begin
  for h in select s.* from public.hotel_settings s where s.enabled and s.buffet_notify_time is not null loop
    begin v_today := (now() at time zone h.timezone)::date; v_now := (now() at time zone h.timezone)::time; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; v_now := (now() at time zone 'Asia/Kolkata')::time; end;
    continue when v_now < h.buffet_notify_time or v_now >= h.buffet_notify_time + interval '30 minutes';
    v_b := public.padh_buffet_today(h.restaurant_id);
    continue when v_b is null;
    insert into public.notifications (restaurant_id, channel, to_ref, template, payload, status, dedupe_key, sent_at)
    values (h.restaurant_id, 'push', 'all-guests', 'buffet_reminder', v_b, 'sent', 'buffet-reminder:' || h.restaurant_id || ':' || v_today, now())
    on conflict (dedupe_key) do nothing returning id into v_claim;
    continue when v_claim is null;
    v_out := v_out || jsonb_build_array(v_b || jsonb_build_object('restaurant_id', h.restaurant_id));
  end loop;
  return v_out;
end $$;
revoke all on function public.padh_buffet_reminders_claim() from public, anon, authenticated;
grant execute on function public.padh_buffet_reminders_claim() to service_role;

-- right after a save: what to announce to the guests, or null (not today's buffet, no buffet, switched off, or already announced in the last 10 minutes)
create or replace function public.padh_buffet_announce(p_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); h public.hotel_settings; v_b jsonb; v_claim uuid; v_today date;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid and enabled;
  if not found or not h.buffet_notify_on_save then return null; end if;
  begin v_today := (now() at time zone h.timezone)::date; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; end;
  if p_date is distinct from v_today then return null; end if;
  v_b := public.padh_buffet_today(v_rid);
  if v_b is null then return null; end if;
  insert into public.notifications (restaurant_id, channel, to_ref, template, payload, status, dedupe_key, sent_at)
  values (v_rid, 'push', 'all-guests', 'buffet_saved', v_b, 'sent', 'buffet-saved:' || v_rid || ':' || floor(extract(epoch from now()) / 600)::bigint, now())
  on conflict (dedupe_key) do nothing returning id into v_claim;
  if v_claim is null then return null; end if;
  return v_b || jsonb_build_object('restaurant_id', v_rid);
end $$;
revoke all on function public.padh_buffet_announce(date) from public, anon, service_role;
grant execute on function public.padh_buffet_announce(date) to authenticated;

create or replace function public.padh_buffet_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); h public.hotel_settings; v_today date;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  begin v_today := (now() at time zone h.timezone)::date; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; end;
  return jsonb_build_object('today', v_today, 'notify_time', to_char(h.buffet_notify_time, 'HH24:MI'), 'notify_on_save', h.buffet_notify_on_save, 'days', (
    select jsonb_agg(jsonb_build_object('date', d::date, 'set', b.id is not null, 'mode', b.mode, 'name', b.name, 'start', to_char(b.start_time, 'HH24:MI'),
             'end', to_char(b.end_time, 'HH24:MI'), 'venue', b.venue, 'highlights', b.highlights, 'mood', b.mood) order by d)
      from generate_series(v_today::timestamp, (v_today + 7)::timestamp, interval '1 day') d
      left join public.buffets b on b.restaurant_id = v_rid and b.service_date = d::date));
end $$;

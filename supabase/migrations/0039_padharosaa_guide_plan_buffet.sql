-- 0039_padharosaa_guide_plan_buffet
-- Jaipur guide (manager-curated; nearby discovery and AI wording only ever create DRAFTS the manager must publish), itineraries,
-- the guest's own day plan (send to the concierge), today's buffet, and "How was it?" feedback.
-- Nothing is ever deleted: removing something archives it. Idempotent.
-- Rollback: drop the functions below, then the added columns.

alter table public.hotel_settings add column if not exists lat numeric(9,6) check (lat is null or lat between -90 and 90);
alter table public.hotel_settings add column if not exists lng numeric(9,6) check (lng is null or lng between -180 and 180);
grant select (lat, lng) on public.hotel_settings to authenticated;

alter table public.guide_items add column if not exists lat numeric(9,6) check (lat is null or lat between -90 and 90);
alter table public.guide_items add column if not exists lng numeric(9,6) check (lng is null or lng between -180 and 180);
alter table public.guide_items add column if not exists address text check (address is null or char_length(address) <= 200);
alter table public.guide_items add column if not exists best_time text check (best_time is null or char_length(best_time) <= 100);
alter table public.guide_items add column if not exists source text not null default 'manual' check (source in ('manual','osm','ai_draft'));
alter table public.guide_items add column if not exists needs_review boolean not null default false;
alter table public.guide_items add column if not exists archived boolean not null default false;
do $$ begin
  alter table public.guide_items add constraint guide_items_draft_not_live check (not (active and needs_review));
exception when duplicate_object then null;
end $$;

alter table public.itineraries add column if not exists archived boolean not null default false;
alter table public.itinerary_stops add column if not exists lat numeric(9,6) check (lat is null or lat between -90 and 90);
alter table public.itinerary_stops add column if not exists lng numeric(9,6) check (lng is null or lng between -180 and 180);
alter table public.itinerary_stops add column if not exists active boolean not null default true;
alter table public.guest_plan_items add column if not exists removed boolean not null default false;
alter table public.guest_plan_items add column if not exists lat numeric(9,6) check (lat is null or lat between -90 and 90);
alter table public.guest_plan_items add column if not exists lng numeric(9,6) check (lng is null or lng between -180 and 180);
create unique index if not exists feedback_request_uq on public.feedback (request_id) where request_id is not null;

-- ---------- manager: hotel location ----------
create or replace function public.padh_set_location(p_lat numeric, p_lng numeric) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  if (p_lat is null) <> (p_lng is null) or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.hotel_settings set lat = round(p_lat, 6), lng = round(p_lng, 6), updated_at = now() where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_location_set', 'hotel_settings', v_rid::text, '{}'::jsonb);
end $$;

-- ---------- manager: the whole guide, drafts included ----------
create or replace function public.padh_guide_manage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); h public.hotel_settings;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  return jsonb_build_object(
    'location', case when h.lat is null then null else jsonb_build_object('lat', h.lat, 'lng', h.lng) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'category', g.category, 'name', g.name, 'description_en', g.description_en, 'description_hi', g.description_hi,
              'maps_query', g.maps_query, 'link_url', g.link_url, 'address', g.address, 'best_time', g.best_time, 'lat', g.lat, 'lng', g.lng,
              'active', g.active, 'needs_review', g.needs_review, 'source', g.source, 'sort', g.sort, 'last_verified_at', g.last_verified_at)
              order by g.needs_review desc, g.category, g.sort, g.name)
              from public.guide_items g where g.restaurant_id = v_rid and not g.archived), '[]'::jsonb),
    'itineraries', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'tagline', i.tagline, 'tip', i.tip, 'active', i.active, 'sort', i.sort,
              'stops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'when_label', s.when_label, 'name', s.name, 'note', s.note, 'maps_query', s.maps_query, 'lat', s.lat, 'lng', s.lng)
                                 order by s.sort) from public.itinerary_stops s where s.itinerary_id = i.id and s.active), '[]'::jsonb))
              order by i.sort, i.name)
              from public.itineraries i where i.restaurant_id = v_rid and not i.archived), '[]'::jsonb));
end $$;

-- one place, tip, food spot or craft. Items from the map or from AI arrive as drafts (needs_review) and go live only when the manager saves them with publish = true.
create or replace function public.padh_guide_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_hotel_staff(array['owner','manager']);
  g public.guide_items; v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_publish boolean := coalesce((p ->> 'publish')::boolean, false);
  v_cat text := p ->> 'category'; v_name text := private.clean_text(p ->> 'name');
  v_source text := coalesce(nullif(p ->> 'source', ''), 'manual');
  v_lat numeric := nullif(p ->> 'lat', '')::numeric; v_lng numeric := nullif(p ->> 'lng', '')::numeric;
  v_sort int;
begin
  if jsonb_typeof(p) <> 'object' or v_cat is null or v_cat not in ('place','food','craft','tip') or char_length(v_name) not between 1 and 100
     or v_source not in ('manual','osm','ai_draft') or (v_lat is null) <> (v_lng is null) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  begin
    if v_id is not null then
      select * into g from public.guide_items where id = v_id and restaurant_id = v_rid and not archived for update;
      if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
      update public.guide_items set category = v_cat, name = v_name,
             description_en = nullif(private.clean_text(p ->> 'description_en'), ''), description_hi = nullif(private.clean_text(p ->> 'description_hi'), ''),
             maps_query = nullif(private.clean_text(p ->> 'maps_query'), ''), link_url = nullif(btrim(coalesce(p ->> 'link_url', '')), ''),
             address = nullif(private.clean_text(p ->> 'address'), ''), best_time = nullif(private.clean_text(p ->> 'best_time'), ''),
             lat = round(v_lat, 6), lng = round(v_lng, 6),
             source = case when v_publish then g.source else v_source end,
             needs_review = case when v_publish then false else coalesce((p ->> 'needs_review')::boolean, g.needs_review) end,
             active = case when v_publish then true when coalesce((p ->> 'needs_review')::boolean, g.needs_review) then false else coalesce((p ->> 'active')::boolean, g.active) end,
             last_verified_at = case when v_publish then current_date else g.last_verified_at end,
             verified_by = case when v_publish then auth.uid() else g.verified_by end
       where id = g.id returning * into g;
    else
      select coalesce(max(sort), 0) + 1 into v_sort from public.guide_items where restaurant_id = v_rid;
      insert into public.guide_items (restaurant_id, category, name, description_en, description_hi, maps_query, link_url, address, best_time, lat, lng,
                                      source, needs_review, active, sort, last_verified_at, verified_by)
      values (v_rid, v_cat, v_name, nullif(private.clean_text(p ->> 'description_en'), ''), nullif(private.clean_text(p ->> 'description_hi'), ''),
              nullif(private.clean_text(p ->> 'maps_query'), ''), nullif(btrim(coalesce(p ->> 'link_url', '')), ''),
              nullif(private.clean_text(p ->> 'address'), ''), nullif(private.clean_text(p ->> 'best_time'), ''), round(v_lat, 6), round(v_lng, 6),
              v_source, (not v_publish) and v_source <> 'manual', v_publish or (v_source = 'manual' and coalesce((p ->> 'active')::boolean, false)), v_sort,
              case when v_publish then current_date end, case when v_publish then auth.uid() end)
      returning * into g;
    end if;
  exception when check_violation then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  perform private.write_audit(v_rid, 'padh_guide_saved', 'guide_items', g.id::text, jsonb_build_object('published', g.active, 'source', g.source));
  return jsonb_build_object('id', g.id, 'active', g.active, 'needs_review', g.needs_review);
end $$;

create or replace function public.padh_guide_archive(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  update public.guide_items set archived = true, active = false where id = p_id and restaurant_id = v_rid and not archived;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  perform private.write_audit(v_rid, 'padh_guide_archived', 'guide_items', p_id::text, '{}'::jsonb);
end $$;

-- an itinerary with its stops. Stops missing from the list are switched off, never removed.
create or replace function public.padh_itinerary_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_hotel_staff(array['owner','manager']); i public.itineraries; v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_name text := private.clean_text(p ->> 'name'); st jsonb; n int := 0; v_sid uuid; v_keep uuid[] := '{}';
begin
  if jsonb_typeof(p) <> 'object' or char_length(v_name) not between 1 and 100 or jsonb_typeof(coalesce(p -> 'stops', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p -> 'stops', '[]'::jsonb)) > 30 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  begin
    if v_id is not null then
      select * into i from public.itineraries where id = v_id and restaurant_id = v_rid and not archived for update;
      if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
      update public.itineraries set name = v_name, tagline = nullif(private.clean_text(p ->> 'tagline'), ''), tip = nullif(private.clean_text(p ->> 'tip'), ''),
             active = coalesce((p ->> 'active')::boolean, active) where id = i.id returning * into i;
    else
      insert into public.itineraries (restaurant_id, name, tagline, tip, active, sort)
      values (v_rid, v_name, nullif(private.clean_text(p ->> 'tagline'), ''), nullif(private.clean_text(p ->> 'tip'), ''), coalesce((p ->> 'active')::boolean, true),
              (select coalesce(max(sort), 0) + 1 from public.itineraries where restaurant_id = v_rid)) returning * into i;
    end if;
    for st in select * from jsonb_array_elements(coalesce(p -> 'stops', '[]'::jsonb)) loop
      n := n + 1;
      v_sid := nullif(st ->> 'id', '')::uuid;
      if v_sid is not null and exists (select 1 from public.itinerary_stops where id = v_sid and itinerary_id = i.id) then
        update public.itinerary_stops set when_label = private.clean_text(st ->> 'when_label'), name = private.clean_text(st ->> 'name'), note = nullif(private.clean_text(st ->> 'note'), ''),
               maps_query = nullif(private.clean_text(st ->> 'maps_query'), ''), lat = round(nullif(st ->> 'lat', '')::numeric, 6), lng = round(nullif(st ->> 'lng', '')::numeric, 6),
               sort = n, active = true where id = v_sid;
      else
        insert into public.itinerary_stops (restaurant_id, itinerary_id, when_label, name, note, maps_query, lat, lng, sort)
        values (v_rid, i.id, private.clean_text(st ->> 'when_label'), private.clean_text(st ->> 'name'), nullif(private.clean_text(st ->> 'note'), ''),
                nullif(private.clean_text(st ->> 'maps_query'), ''), round(nullif(st ->> 'lat', '')::numeric, 6), round(nullif(st ->> 'lng', '')::numeric, 6), n)
        returning id into v_sid;
      end if;
      v_keep := v_keep || v_sid;
    end loop;
    update public.itinerary_stops set active = false where itinerary_id = i.id and active and not (id = any (v_keep));
  exception when check_violation then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  perform private.write_audit(v_rid, 'padh_itinerary_saved', 'itineraries', i.id::text, jsonb_build_object('stops', n));
  return jsonb_build_object('id', i.id);
end $$;

create or replace function public.padh_itinerary_archive(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  update public.itineraries set archived = true, active = false where id = p_id and restaurant_id = v_rid and not archived;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
end $$;

-- ---------- manager: buffet for the coming days ----------
create or replace function public.padh_buffet_list() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); h public.hotel_settings; v_today date;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  begin v_today := (now() at time zone h.timezone)::date; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; end;
  return jsonb_build_object('today', v_today, 'days', (
    select jsonb_agg(jsonb_build_object('date', d::date, 'set', b.id is not null, 'mode', b.mode, 'name', b.name, 'start', to_char(b.start_time, 'HH24:MI'),
             'end', to_char(b.end_time, 'HH24:MI'), 'venue', b.venue, 'highlights', b.highlights, 'mood', b.mood) order by d)
      from generate_series(v_today::timestamp, (v_today + 7)::timestamp, interval '1 day') d
      left join public.buffets b on b.restaurant_id = v_rid and b.service_date = d::date));
end $$;

create or replace function public.padh_buffet_set(p_date date, p_mode text, p_name text, p_start time, p_end time, p_venue text, p_highlights text, p_mood text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); h public.hotel_settings; v_today date; b public.buffets;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  begin v_today := (now() at time zone h.timezone)::date; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; end;
  if p_date is null or p_date < v_today - 1 or p_date > v_today + 30 or p_mode is null or p_mode not in ('in_house','outdoor','none') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  begin
    insert into public.buffets (restaurant_id, service_date, mode, name, start_time, end_time, venue, highlights, mood, updated_by)
    values (v_rid, p_date, p_mode, case when p_mode = 'none' then null else nullif(private.clean_text(p_name), '') end, case when p_mode = 'none' then null else p_start end,
            case when p_mode = 'none' then null else p_end end, nullif(private.clean_text(p_venue), ''), nullif(private.clean_text(p_highlights), ''), nullif(private.clean_text(p_mood), ''), auth.uid())
    on conflict (restaurant_id, service_date) do update
      set mode = excluded.mode, name = excluded.name, start_time = excluded.start_time, end_time = excluded.end_time, venue = excluded.venue,
          highlights = excluded.highlights, mood = excluded.mood, version = public.buffets.version + 1, updated_by = auth.uid(), updated_at = now()
    returning * into b;
  exception when check_violation then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  perform private.write_audit(v_rid, 'padh_buffet_set', 'buffets', b.id::text, jsonb_build_object('date', p_date, 'mode', p_mode));
  return jsonb_build_object('id', b.id, 'version', b.version);
end $$;

-- ---------- guest (service role): guide, plan, buffet, feedback ----------
create or replace function public.padh_guest_guide(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  return jsonb_build_object(
    'hotel', case when h.lat is null then null else jsonb_build_object('lat', h.lat, 'lng', h.lng) end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'category', g.category, 'name', g.name,
              'description', case when s.language = 'hi' and g.description_hi is not null then g.description_hi else g.description_en end,
              'maps_query', g.maps_query, 'link_url', g.link_url, 'address', g.address, 'best_time', g.best_time, 'lat', g.lat, 'lng', g.lng) order by g.category, g.sort, g.name)
              from public.guide_items g where g.restaurant_id = s.restaurant_id and g.active and not g.archived and not g.needs_review), '[]'::jsonb),
    'itineraries', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'tagline', i.tagline, 'tip', i.tip,
              'stops', coalesce((select jsonb_agg(jsonb_build_object('when_label', t.when_label, 'name', t.name, 'note', t.note, 'maps_query', t.maps_query, 'lat', t.lat, 'lng', t.lng) order by t.sort)
                                 from public.itinerary_stops t where t.itinerary_id = i.id and t.active), '[]'::jsonb)) order by i.sort, i.name)
              from public.itineraries i where i.restaurant_id = s.restaurant_id and i.active and not i.archived), '[]'::jsonb));
end $$;

create or replace function public.padh_guest_plan(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare gp public.guest_plans;
begin
  if not exists (select 1 from public.guest_sessions where id = p_session and status = 'active') then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  select * into gp from public.guest_plans where session_id = p_session;
  return jsonb_build_object('requested_at', gp.requested_at, 'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'when_label', i.when_label,
            'maps_query', i.maps_query, 'lat', i.lat, 'lng', i.lng) order by i.sort, i.id) from public.guest_plan_items i where i.plan_id = gp.id and not i.removed), '[]'::jsonb));
end $$;

create or replace function private.plan_for(p_session uuid) returns public.guest_plans
language plpgsql security definer set search_path = '' as $$
declare s public.guest_sessions; gp public.guest_plans;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  insert into public.guest_plans (restaurant_id, session_id) values (s.restaurant_id, s.id) on conflict (session_id) do nothing;
  select * into gp from public.guest_plans where session_id = s.id;
  return gp;
end $$;
revoke all on function private.plan_for(uuid) from public, anon, authenticated;

create or replace function public.padh_guest_plan_add(p_session uuid, p_name text, p_when text, p_maps_query text, p_lat numeric, p_lng numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare gp public.guest_plans; v_name text := private.clean_text(p_name); n int;
begin
  if char_length(v_name) not between 1 and 100 or (p_lat is null) <> (p_lng is null) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  gp := private.plan_for(p_session);
  select count(*) into n from public.guest_plan_items where plan_id = gp.id and not removed;
  if n >= 30 then raise exception using errcode = 'GM006', message = 'limit_exceeded'; end if;
  if not exists (select 1 from public.guest_plan_items where plan_id = gp.id and not removed and lower(name) = lower(v_name)) then
    begin
      insert into public.guest_plan_items (restaurant_id, plan_id, name, when_label, maps_query, lat, lng, sort)
      values (gp.restaurant_id, gp.id, v_name, nullif(private.clean_text(p_when), ''), nullif(private.clean_text(p_maps_query), ''), round(p_lat, 6), round(p_lng, 6),
              coalesce((select max(sort) from public.guest_plan_items where plan_id = gp.id), 0) + 1);
    exception when check_violation then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end;
  end if;
  return public.padh_guest_plan(p_session);
end $$;

create or replace function public.padh_guest_plan_remove(p_session uuid, p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare gp public.guest_plans;
begin
  gp := private.plan_for(p_session);
  update public.guest_plans set requested_at = null where id = gp.id and requested_at is not null;
  update public.guest_plan_items set removed = true where id = p_item and plan_id = gp.id;
  return public.padh_guest_plan(p_session);
end $$;

create or replace function public.padh_guest_plan_use(p_session uuid, p_itinerary uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare gp public.guest_plans; s public.guest_sessions; st record; n int;
begin
  gp := private.plan_for(p_session);
  select * into s from public.guest_sessions where id = p_session;
  if not exists (select 1 from public.itineraries where id = p_itinerary and restaurant_id = s.restaurant_id and active and not archived) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  select count(*) into n from public.guest_plan_items where plan_id = gp.id and not removed;
  for st in select t.name, t.when_label, t.maps_query, t.lat, t.lng from public.itinerary_stops t where t.itinerary_id = p_itinerary and t.active order by t.sort loop
    exit when n >= 30;
    if not exists (select 1 from public.guest_plan_items where plan_id = gp.id and not removed and lower(name) = lower(st.name)) then
      insert into public.guest_plan_items (restaurant_id, plan_id, name, when_label, maps_query, lat, lng, sort)
      values (gp.restaurant_id, gp.id, st.name, st.when_label, st.maps_query, st.lat, st.lng, coalesce((select max(sort) from public.guest_plan_items where plan_id = gp.id), 0) + 1);
      n := n + 1;
    end if;
  end loop;
  return public.padh_guest_plan(p_session);
end $$;

-- "Send my plan to the concierge": one request that lists the stops, so the team can arrange cabs, tickets and timings
create or replace function public.padh_guest_plan_send(p_session uuid, p_idem text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare gp public.guest_plans; v_text text; out jsonb;
begin
  gp := private.plan_for(p_session);
  select string_agg(coalesce(when_label || ': ', '') || name, E'\n' order by sort, id) into v_text from public.guest_plan_items where plan_id = gp.id and not removed;
  if v_text is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  out := public.padh_guest_create_request(p_session, 'plan', 'My day plan', left(v_text, 500), false, p_idem);
  update public.guest_plans set requested_at = now() where id = gp.id;
  return out;
end $$;

create or replace function public.padh_guest_buffet(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.guest_sessions; h public.hotel_settings; v_today date;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  begin v_today := (now() at time zone h.timezone)::date; exception when others then v_today := (now() at time zone 'Asia/Kolkata')::date; end;
  return jsonb_build_object('today', v_today, 'days', coalesce((select jsonb_agg(jsonb_build_object('date', b.service_date, 'mode', b.mode, 'name', b.name,
            'start', to_char(b.start_time, 'HH24:MI'), 'end', to_char(b.end_time, 'HH24:MI'), 'venue', b.venue, 'highlights', b.highlights, 'mood', b.mood) order by b.service_date)
            from public.buffets b where b.restaurant_id = s.restaurant_id and b.service_date between v_today and v_today + 2), '[]'::jsonb));
end $$;

-- "How was it?" once a request is done. A good rating invites a review; a poor one alerts the manager (never both, never silently).
create or replace function public.padh_guest_feedback(p_session uuid, p_request uuid, p_rating text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q public.requests; s public.guest_sessions; n public.requests;
begin
  if p_rating is null or p_rating not in ('great','okay','not_good') then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  select * into q from public.requests where id = p_request and session_id = p_session and status = 'completed';
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  insert into public.feedback (restaurant_id, session_id, request_id, rating) values (s.restaurant_id, s.id, q.id, p_rating)
  on conflict (request_id) where request_id is not null do nothing;
  if not found then return jsonb_build_object('rating', p_rating, 'already', true); end if;
  if p_rating = 'not_good' then
    insert into public.requests (restaurant_id, session_id, room_id, type, team, label, detail, urgent, parent_request_id)
    values (s.restaurant_id, s.id, s.room_id, 'feedback_alert', 'manager', left('Guest was not happy: ' || q.label, 120), null, true, q.id) returning * into n;
    perform private.req_event(n, 'system', null, 'created', jsonb_build_object('feedback_for', q.id));
  end if;
  return jsonb_build_object('rating', p_rating, 'review_invite', p_rating = 'great');
end $$;

revoke all on function public.padh_set_location(numeric, numeric), public.padh_guide_manage(), public.padh_guide_save(jsonb), public.padh_guide_archive(uuid),
  public.padh_itinerary_save(jsonb), public.padh_itinerary_archive(uuid), public.padh_buffet_list(),
  public.padh_buffet_set(date, text, text, time, time, text, text, text) from public, anon, service_role;
grant execute on function public.padh_set_location(numeric, numeric), public.padh_guide_manage(), public.padh_guide_save(jsonb), public.padh_guide_archive(uuid),
  public.padh_itinerary_save(jsonb), public.padh_itinerary_archive(uuid), public.padh_buffet_list(),
  public.padh_buffet_set(date, text, text, time, time, text, text, text) to authenticated;
revoke all on function public.padh_guest_guide(uuid), public.padh_guest_plan(uuid), public.padh_guest_plan_add(uuid, text, text, text, numeric, numeric),
  public.padh_guest_plan_remove(uuid, uuid), public.padh_guest_plan_use(uuid, uuid), public.padh_guest_plan_send(uuid, text), public.padh_guest_buffet(uuid),
  public.padh_guest_feedback(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.padh_guest_guide(uuid), public.padh_guest_plan(uuid), public.padh_guest_plan_add(uuid, text, text, text, numeric, numeric),
  public.padh_guest_plan_remove(uuid, uuid), public.padh_guest_plan_use(uuid, uuid), public.padh_guest_plan_send(uuid, text), public.padh_guest_buffet(uuid),
  public.padh_guest_feedback(uuid, uuid, text) to service_role;

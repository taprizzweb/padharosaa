-- 0075_channel_manager
-- Channel manager: the hotel's prices and the rooms it has left are sent to the booking sites (through a channel-manager service),
-- and a booking made on a site arrives here as a reservation. This file holds the data and the rules; the app talks to the service.
--  * channel_links: one row per hotel (the service's property id, on/off, a secret in the webhook address, when it last ran).
--  * channel_maps: which of our room types is which room type and rate plan at the service.
--  * channel_outbox: "these days of this room type changed", written by triggers, emptied by the sender (a price, a booking, a guest checking in...).
--  * reservations get the site's name and the site's own booking number, so one booking is never entered twice.
-- RLS is on with no policy; staff reach it only through the functions below and the app's sender uses the service role. Idempotent.
-- Rollback: drop the triggers and functions, the three tables, and the added reservation columns.
create table if not exists public.channel_links (
  restaurant_id  uuid primary key references public.restaurants (id) on delete cascade,
  provider       text not null default 'channex' check (provider in ('channex')),
  property_id    text check (property_id is null or property_id ~ '^[A-Za-z0-9-]{8,64}$'),
  enabled        boolean not null default false,
  webhook_secret text not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  last_push_at   timestamptz,
  last_pull_at   timestamptz,
  last_error     text check (last_error is null or char_length(last_error) <= 300),
  updated_at     timestamptz not null default now(),
  unique (webhook_secret)
);
alter table public.channel_links enable row level security;

create table if not exists public.channel_maps (
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  room_type_id      uuid primary key,
  ext_room_type_id  text not null check (ext_room_type_id ~ '^[A-Za-z0-9-]{8,64}$'),
  ext_rate_plan_id  text not null check (ext_rate_plan_id ~ '^[A-Za-z0-9-]{8,64}$'),
  constraint channel_maps_type_fk foreign key (room_type_id, restaurant_id) references public.room_types (id, restaurant_id) on delete cascade,
  unique (restaurant_id, ext_room_type_id)
);
alter table public.channel_maps enable row level security;

create table if not exists public.channel_outbox (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  room_type_id  uuid not null,
  day_from      date not null,
  day_to        date not null check (day_to > day_from),
  created_at    timestamptz not null default now(),
  picked_at     timestamptz,
  done_at       timestamptz,
  attempts      int not null default 0,
  error         text check (error is null or char_length(error) <= 300)
);
create index if not exists channel_outbox_todo_idx on public.channel_outbox (id) where done_at is null;
alter table public.channel_outbox enable row level security;

alter table public.reservations add column if not exists channel text check (channel is null or char_length(channel) <= 40);
alter table public.reservations add column if not exists external_ref text check (external_ref is null or char_length(external_ref) <= 120);
alter table public.reservations add column if not exists external_rev text check (external_rev is null or char_length(external_rev) <= 120);
create unique index if not exists reservations_external_idx on public.reservations (restaurant_id, external_ref) where external_ref is not null;

-- rooms of a type still to sell on a day, as a plain number that can go below zero (a booking site sold a room that was already gone)
create or replace function private.type_balance(p_rid uuid, p_type uuid, p_day date) returns int
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.rooms r where r.restaurant_id = p_rid and r.room_type_id = p_type and r.active and r.hk_status <> 'out_of_order')::int
    - (select count(*) from public.stays s join public.rooms r on r.id = s.room_id
        where s.restaurant_id = p_rid and r.room_type_id = p_type and s.status = 'in_house'
          and (s.check_in_at at time zone coalesce((select timezone from public.hotel_settings where restaurant_id = p_rid), 'Asia/Kolkata'))::date <= p_day
          and (p_day < s.check_out_on or p_day = private.hotel_today(p_rid)))::int
    - (select count(*) from public.reservations v where v.restaurant_id = p_rid and v.room_type_id = p_type and v.status = 'booked' and v.check_in_on <= p_day and p_day < v.check_out_on)::int
$$;
revoke all on function private.type_balance(uuid, uuid, date) from public, anon, authenticated;
create or replace function private.type_free(p_rid uuid, p_type uuid, p_day date) returns int
language sql stable security definer set search_path = '' as $$ select greatest(0, private.type_balance(p_rid, p_type, p_day)) $$;
revoke all on function private.type_free(uuid, uuid, date) from public, anon, authenticated;

-- note that days of a room type changed (only for hotels that have the channel manager switched on and this type mapped)
create or replace function private.channel_enqueue(p_rid uuid, p_type uuid, p_from date, p_to date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_type is null or p_from is null or p_to is null then return; end if;
  if p_to <= p_from then p_to := p_from + 1; end if;
  if p_to > p_from + 366 then p_to := p_from + 366; end if;
  if not exists (select 1 from public.channel_links l join public.channel_maps m on m.restaurant_id = l.restaurant_id and m.room_type_id = p_type where l.restaurant_id = p_rid and l.enabled) then return; end if;
  if exists (select 1 from public.channel_outbox o where o.restaurant_id = p_rid and o.room_type_id = p_type and o.done_at is null and o.picked_at is null and o.day_from <= p_from and o.day_to >= p_to) then return; end if;
  insert into public.channel_outbox (restaurant_id, room_type_id, day_from, day_to) values (p_rid, p_type, p_from, p_to);
end $$;
revoke all on function private.channel_enqueue(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function private.trg_channel_reservation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' and (tg_op = 'DELETE' or old.status is distinct from new.status or old.check_in_on is distinct from new.check_in_on or old.check_out_on is distinct from new.check_out_on or old.room_type_id is distinct from new.room_type_id) then
    perform private.channel_enqueue(old.restaurant_id, old.room_type_id, old.check_in_on, old.check_out_on);
  end if;
  if tg_op <> 'DELETE' then perform private.channel_enqueue(new.restaurant_id, new.room_type_id, new.check_in_on, new.check_out_on); end if;
  return null;
end $$;
revoke all on function private.trg_channel_reservation() from public, anon, authenticated;
drop trigger if exists channel_reservation on public.reservations;
create trigger channel_reservation after insert or update or delete on public.reservations for each row execute function private.trg_channel_reservation();

create or replace function private.trg_channel_stay() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_type uuid; v_tz text; v_today date;
begin
  if tg_op = 'UPDATE' and old.status = new.status and old.check_out_on = new.check_out_on and old.room_id = new.room_id then return null; end if;
  select room_type_id into v_type from public.rooms where id = new.room_id;
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from public.hotel_settings where restaurant_id = new.restaurant_id;
  v_today := private.hotel_today(new.restaurant_id);
  perform private.channel_enqueue(new.restaurant_id, v_type, least((new.check_in_at at time zone coalesce(v_tz, 'Asia/Kolkata'))::date, v_today), greatest(new.check_out_on, v_today + 1));
  return null;
end $$;
revoke all on function private.trg_channel_stay() from public, anon, authenticated;
drop trigger if exists channel_stay on public.stays;
create trigger channel_stay after insert or update on public.stays for each row execute function private.trg_channel_stay();

create or replace function private.trg_channel_room() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.hotel_today(new.restaurant_id);
begin
  if old.active is distinct from new.active or old.room_type_id is distinct from new.room_type_id or (old.hk_status = 'out_of_order') is distinct from (new.hk_status = 'out_of_order') then
    perform private.channel_enqueue(new.restaurant_id, old.room_type_id, v_today, v_today + 366);
    if new.room_type_id is distinct from old.room_type_id then perform private.channel_enqueue(new.restaurant_id, new.room_type_id, v_today, v_today + 366); end if;
  end if;
  return null;
end $$;
revoke all on function private.trg_channel_room() from public, anon, authenticated;
drop trigger if exists channel_room on public.rooms;
create trigger channel_room after update on public.rooms for each row execute function private.trg_channel_room();

create or replace function private.trg_channel_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform private.channel_enqueue(old.restaurant_id, old.room_type_id, old.day, old.day + 1);
  else perform private.channel_enqueue(new.restaurant_id, new.room_type_id, new.day, new.day + 1); end if;
  return null;
end $$;
revoke all on function private.trg_channel_rate() from public, anon, authenticated;
drop trigger if exists channel_rate on public.room_rates;
create trigger channel_rate after insert or update or delete on public.room_rates for each row execute function private.trg_channel_rate();

create or replace function private.trg_channel_type() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_today date := private.hotel_today(new.restaurant_id);
begin
  if old.rate_paise is distinct from new.rate_paise then perform private.channel_enqueue(new.restaurant_id, new.id, v_today, v_today + 366); end if;
  return null;
end $$;
revoke all on function private.trg_channel_type() from public, anon, authenticated;
drop trigger if exists channel_type on public.room_types;
create trigger channel_type after update on public.room_types for each row execute function private.trg_channel_type();

-- ---------- staff: set up and watch ----------
create or replace function public.padh_channel_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); l public.channel_links;
begin
  select * into l from public.channel_links where restaurant_id = v_rid;
  return jsonb_build_object(
    'link', case when l.restaurant_id is null then null else jsonb_build_object('provider', l.provider, 'property_id', l.property_id, 'enabled', l.enabled, 'webhook_secret', l.webhook_secret,
      'last_push_at', l.last_push_at, 'last_pull_at', l.last_pull_at, 'last_error', l.last_error) end,
    'types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'rooms', (select count(*) from public.rooms r where r.room_type_id = t.id and r.active),
        'ext_room_type_id', m.ext_room_type_id, 'ext_rate_plan_id', m.ext_rate_plan_id) order by t.name)
      from public.room_types t left join public.channel_maps m on m.room_type_id = t.id where t.restaurant_id = v_rid and t.active), '[]'::jsonb),
    'waiting', (select count(*) from public.channel_outbox where restaurant_id = v_rid and done_at is null and attempts < 6),
    'failed', (select count(*) from public.channel_outbox where restaurant_id = v_rid and done_at is null and attempts >= 6),
    'channel_bookings', (select count(*) from public.reservations where restaurant_id = v_rid and external_ref is not null));
end $$;
revoke all on function public.padh_channel_get() from public, anon, service_role;
grant execute on function public.padh_channel_get() to authenticated;

create or replace function public.padh_channel_save(p_property text, p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_prop text := nullif(btrim(coalesce(p_property, '')), '');
begin
  if p_enabled is null or (v_prop is not null and v_prop !~ '^[A-Za-z0-9-]{8,64}$') or (p_enabled and v_prop is null) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if p_enabled and not exists (select 1 from public.channel_maps where restaurant_id = v_rid) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  insert into public.channel_links (restaurant_id, property_id, enabled) values (v_rid, v_prop, p_enabled)
  on conflict (restaurant_id) do update set property_id = excluded.property_id, enabled = excluded.enabled, last_error = null, updated_at = now();
  perform private.write_audit(v_rid, 'padh_channel_save', 'channel_links', v_rid::text, jsonb_build_object('enabled', p_enabled));
  if p_enabled then
    perform private.channel_enqueue(v_rid, m.room_type_id, private.hotel_today(v_rid), private.hotel_today(v_rid) + 366) from public.channel_maps m where m.restaurant_id = v_rid;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_channel_save(text, boolean) from public, anon, service_role;
grant execute on function public.padh_channel_save(text, boolean) to authenticated;

-- both ids empty = remove the link for this room type
create or replace function public.padh_channel_map(p_type uuid, p_ext_room text, p_ext_rate text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_room text := nullif(btrim(coalesce(p_ext_room, '')), ''); v_rate text := nullif(btrim(coalesce(p_ext_rate, '')), '');
begin
  if not exists (select 1 from public.room_types where id = p_type and restaurant_id = v_rid) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if (v_room is null) <> (v_rate is null) or (v_room is not null and (v_room !~ '^[A-Za-z0-9-]{8,64}$' or v_rate !~ '^[A-Za-z0-9-]{8,64}$')) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if v_room is null then
    delete from public.channel_maps where room_type_id = p_type and restaurant_id = v_rid;
  else
    if exists (select 1 from public.channel_maps where restaurant_id = v_rid and ext_room_type_id = v_room and room_type_id <> p_type) then raise exception using errcode = 'GM019', message = 'conflict'; end if;
    insert into public.channel_maps (restaurant_id, room_type_id, ext_room_type_id, ext_rate_plan_id) values (v_rid, p_type, v_room, v_rate)
    on conflict (room_type_id) do update set ext_room_type_id = excluded.ext_room_type_id, ext_rate_plan_id = excluded.ext_rate_plan_id;
    perform private.channel_enqueue(v_rid, p_type, private.hotel_today(v_rid), private.hotel_today(v_rid) + 366);
  end if;
  perform private.write_audit(v_rid, 'padh_channel_map', 'room_types', p_type::text, jsonb_build_object('linked', v_room is not null));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_channel_map(uuid, text, text) from public, anon, service_role;
grant execute on function public.padh_channel_map(uuid, text, text) to authenticated;

-- "send everything again": the next year of prices and rooms for every linked room type
create or replace function public.padh_channel_resync() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_n int := 0; m record;
begin
  if not exists (select 1 from public.channel_links where restaurant_id = v_rid and enabled) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if not private.rl_hit('padh_channel_resync:' || v_rid::text, 20, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  update public.channel_outbox set attempts = 0, picked_at = null, error = null where restaurant_id = v_rid and done_at is null;
  for m in select room_type_id from public.channel_maps where restaurant_id = v_rid loop
    insert into public.channel_outbox (restaurant_id, room_type_id, day_from, day_to) values (v_rid, m.room_type_id, private.hotel_today(v_rid), private.hotel_today(v_rid) + 366);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('queued', v_n);
end $$;
revoke all on function public.padh_channel_resync() from public, anon, service_role;
grant execute on function public.padh_channel_resync() to authenticated;

-- ---------- the app's sender and receiver (service role only) ----------
-- Takes the waiting changes, merged per room type, with the final price, stop-sell, minimum stay and free rooms of every day in the range.
create or replace function public.padh_channel_claim(p_limit int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_out jsonb;
begin
  with picked as (
    update public.channel_outbox o set picked_at = now(), attempts = o.attempts + 1
     where o.id in (select id from public.channel_outbox where done_at is null and attempts < 6 and (picked_at is null or picked_at < now() - interval '5 minutes') order by id limit greatest(1, least(coalesce(p_limit, 50), 200)) for update skip locked)
    returning o.*),
  grp as (
    select restaurant_id, room_type_id, min(day_from) as d_from, least(max(day_to), min(day_from) + 366) as d_to, array_agg(id) as ids from picked group by restaurant_id, room_type_id)
  select coalesce(jsonb_agg(jsonb_build_object('restaurant_id', g.restaurant_id, 'room_type_id', g.room_type_id, 'ids', g.ids, 'property_id', l.property_id,
      'ext_room_type_id', m.ext_room_type_id, 'ext_rate_plan_id', m.ext_rate_plan_id, 'from', g.d_from, 'to', g.d_to,
      'days', (select jsonb_agg(jsonb_build_object('day', d::date, 'rate_paise', private.type_rate(g.room_type_id, d::date), 'stop_sell', coalesce((select rr.stop_sell from public.room_rates rr where rr.room_type_id = g.room_type_id and rr.day = d::date), false),
          'min_stay', (select rr.min_stay from public.room_rates rr where rr.room_type_id = g.room_type_id and rr.day = d::date), 'free', private.type_free(g.restaurant_id, g.room_type_id, d::date)) order by d)
        from generate_series(g.d_from, g.d_to - 1, interval '1 day') d))), '[]'::jsonb)
    into v_out
    from grp g join public.channel_links l on l.restaurant_id = g.restaurant_id and l.enabled join public.channel_maps m on m.room_type_id = g.room_type_id;
  -- rows whose hotel switched the channel off or whose room type is no longer linked: nothing to send
  update public.channel_outbox o set done_at = now(), error = 'not linked' where o.done_at is null and o.picked_at is not null and o.picked_at > now() - interval '1 minute'
    and not exists (select 1 from public.channel_links l join public.channel_maps m on m.restaurant_id = l.restaurant_id and m.room_type_id = o.room_type_id where l.restaurant_id = o.restaurant_id and l.enabled);
  return v_out;
end $$;
revoke all on function public.padh_channel_claim(int) from public, anon, authenticated;
grant execute on function public.padh_channel_claim(int) to service_role;

-- p_ids: JSON array text of outbox ids. p_error null = sent; otherwise it will be tried again (up to 6 times)
create or replace function public.padh_channel_done(p_rid uuid, p_ids text, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ids bigint[]; v_err text := left(nullif(btrim(coalesce(p_error, '')), ''), 300);
begin
  select array_agg(x::bigint) into v_ids from jsonb_array_elements_text(p_ids::jsonb) x;
  if v_err is null then
    update public.channel_outbox set done_at = now(), error = null where id = any (v_ids) and restaurant_id = p_rid;
    update public.channel_links set last_push_at = now(), last_error = null where restaurant_id = p_rid;
  else
    update public.channel_outbox set picked_at = null, error = v_err where id = any (v_ids) and restaurant_id = p_rid;
    update public.channel_links set last_error = v_err where restaurant_id = p_rid;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_channel_done(uuid, text, text) from public, anon, authenticated;
grant execute on function public.padh_channel_done(uuid, text, text) to service_role;

create or replace function public.padh_channel_by_secret(p_secret text) returns jsonb
language sql security definer set search_path = '' as $$
  select (select jsonb_build_object('restaurant_id', restaurant_id, 'property_id', property_id) from public.channel_links where webhook_secret = p_secret and enabled and property_id is not null)
$$;
revoke all on function public.padh_channel_by_secret(text) from public, anon, authenticated;
grant execute on function public.padh_channel_by_secret(text) to service_role;

-- hotels to look at for new bookings; p_stale_minutes: only those not looked at for that long (0 = all)
create or replace function public.padh_channel_pull_due(p_stale_minutes int) returns jsonb
language sql security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('restaurant_id', restaurant_id, 'property_id', property_id)), '[]'::jsonb)
    from public.channel_links where enabled and property_id is not null and (last_pull_at is null or last_pull_at < now() - make_interval(mins => greatest(0, coalesce(p_stale_minutes, 0))))
$$;
revoke all on function public.padh_channel_pull_due(int) from public, anon, authenticated;
grant execute on function public.padh_channel_pull_due(int) to service_role;

create or replace function public.padh_channel_pulled(p_rid uuid, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.channel_links set last_pull_at = now(), last_error = coalesce(left(nullif(btrim(coalesce(p_error, '')), ''), 300), case when last_error like 'Booking%' then null else last_error end) where restaurant_id = p_rid;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_channel_pulled(uuid, text) from public, anon, authenticated;
grant execute on function public.padh_channel_pulled(uuid, text) to service_role;

-- One booking revision from a booking site (already turned into this shape by the app). 'new' and 'modified' write the reservation,
-- 'cancelled' cancels it. The site's booking is already confirmed, so it is always accepted; if no room is left it is marked "overbooked".
-- {"ext_id","revision","status","channel","guest","mobile","adults","check_in","check_out","ext_room_type_id","rate_paise","notes"}
create or replace function public.padh_channel_booking_apply(p_rid uuid, p_payload text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j jsonb; v_status text; v_ext text; v_type uuid; v_in date; v_out date; v_name text; v_mobile text; v_adults int; v_rate int; v_chan text; v_notes text; v_rev text;
  r public.reservations; v_seq int; v_id uuid; v_over boolean; v_room uuid; v_known boolean;
begin
  begin j := p_payload::jsonb; exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  v_status := j->>'status'; v_ext := left(btrim(coalesce(j->>'ext_id', '')), 120); v_rev := left(coalesce(j->>'revision', ''), 120);
  v_chan := left(coalesce(private.bill_text(j->>'channel'), 'Booking site'), 40);
  if v_status not in ('new','modified','cancelled') or v_ext = '' then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into r from public.reservations where restaurant_id = p_rid and external_ref = v_ext for update;
  v_known := found;
  if v_status = 'cancelled' then
    if not v_known then return jsonb_build_object('action', 'ignored'); end if;
    if r.status <> 'booked' then return jsonb_build_object('action', 'kept', 'reason', r.status); end if;
    update public.reservations set status = 'cancelled', cancel_reason = left('Cancelled on ' || v_chan, 200), external_rev = v_rev where id = r.id;
    return jsonb_build_object('action', 'cancelled', 'id', r.id);
  end if;
  select room_type_id into v_type from public.channel_maps where restaurant_id = p_rid and ext_room_type_id = coalesce(j->>'ext_room_type_id', '');
  if v_type is null then return jsonb_build_object('action', 'unmapped'); end if;
  begin v_in := (j->>'check_in')::date; v_out := (j->>'check_out')::date; v_adults := coalesce((j->>'adults')::int, 1); v_rate := coalesce((j->>'rate_paise')::int, 0);
  exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  v_name := private.bill_text(j->>'guest');
  if v_name is null or char_length(v_name) < 2 then v_name := 'Guest (' || v_chan || ')'; end if;
  v_name := left(v_name, 80);
  v_mobile := nullif(regexp_replace(coalesce(j->>'mobile', ''), '[^0-9]', '', 'g'), '');
  if v_mobile is not null and v_mobile !~ '^[0-9]{10,15}$' then v_mobile := null; end if;
  v_adults := least(20, greatest(1, v_adults)); v_rate := least(10000000, greatest(0, v_rate));
  v_notes := left(private.bill_text(j->>'notes'), 300);
  if v_in is null or v_out is null or v_out <= v_in or v_out > v_in + 90 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if v_known then
    if r.status <> 'booked' then return jsonb_build_object('action', 'kept', 'reason', r.status); end if;
    v_room := case when r.room_id is not null and (v_in, v_out) = (r.check_in_on, r.check_out_on) and exists (select 1 from public.rooms where id = r.room_id and room_type_id = v_type) then r.room_id else null end;
    update public.reservations set room_id = v_room, room_type_id = v_type, guest_name = v_name, mobile = v_mobile, adults = v_adults, check_in_on = v_in, check_out_on = v_out, rate_paise = v_rate,
      notes = v_notes, channel = v_chan, source = v_chan, external_rev = v_rev where id = r.id returning id into v_id;
  else
    perform pg_advisory_xact_lock(hashtext('padh_res:' || p_rid::text));
    select coalesce(max(seq), 0) + 1 into v_seq from public.reservations where restaurant_id = p_rid;
    insert into public.reservations (restaurant_id, seq, room_type_id, guest_name, mobile, adults, check_in_on, check_out_on, rate_paise, source, notes, channel, external_ref, external_rev)
    values (p_rid, v_seq, v_type, v_name, v_mobile, v_adults, v_in, v_out, v_rate, v_chan, v_notes, v_chan, v_ext, v_rev) returning id into v_id;
  end if;
  select exists (select 1 from generate_series(v_in, v_out - 1, interval '1 day') d where private.type_balance(p_rid, v_type, d::date) < 0) into v_over;
  if v_over then update public.reservations set notes = left('OVERBOOKED: no free room. ' || coalesce(notes, ''), 300) where id = v_id and coalesce(notes, '') not like 'OVERBOOKED%'; end if;
  return jsonb_build_object('action', case when v_known then 'updated' else 'created' end, 'id', v_id, 'overbooked', v_over);
end $$;
revoke all on function public.padh_channel_booking_apply(uuid, text) from public, anon, authenticated;
grant execute on function public.padh_channel_booking_apply(uuid, text) to service_role;

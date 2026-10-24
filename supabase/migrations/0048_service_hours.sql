-- 0048_service_hours
-- The owner can set a starting time and a closing time. Outside those hours no guest request reaches the desk: a Padharosaa request,
-- a help call, a food order from a hotel room, or a waiter call from a room (asking for the bill stays possible). From the next opening time they arrive again.
-- No times set (both empty) means open all day, as before. A window that crosses midnight (for example 18:00 to 02:00) works.
-- The check is a trigger on the tables the guest writes to, so it holds on every path (the app, the API, a direct call).
-- Idempotent. Rollback: drop the four triggers, drop private.guard_service_hours, private.guard_service_hours_room, private.service_open, public.padh_service_hours_set and
-- public.padh_service_hours_guest, restore padh_manage_settings from 0045, and drop the two columns.

alter table public.hotel_settings add column if not exists service_start time;
alter table public.hotel_settings add column if not exists service_end time;

create or replace function private.service_open(p_restaurant uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare h public.hotel_settings; t time;
begin
  select * into h from public.hotel_settings where restaurant_id = p_restaurant and enabled;
  if not found or h.service_start is null or h.service_end is null or h.service_start = h.service_end then return true; end if;
  begin t := (now() at time zone h.timezone)::time; exception when others then t := (now() at time zone 'Asia/Kolkata')::time; end;
  if h.service_start < h.service_end then return t >= h.service_start and t < h.service_end; end if;
  return t >= h.service_start or t < h.service_end;
end $$;
revoke all on function private.service_open(uuid) from public, anon, authenticated;

-- requests and help_requests: every row is a hotel guest's request
create or replace function private.guard_service_hours() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.is_hotel(new.restaurant_id) and not private.service_open(new.restaurant_id) then
    raise exception using errcode = 'GM025', message = 'service_closed';
  end if;
  return new;
end $$;
revoke all on function private.guard_service_hours() from public, anon, authenticated;

-- orders and service_requests: only a hotel room counts (an ordinary restaurant table is not a room request), and a guest can always ask for the bill
create or replace function private.guard_service_hours_room() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if to_jsonb(new) ->> 'type' = 'bill' then return new; end if;
  if not exists (select 1 from public.dining_tables t where t.id = new.table_id and t.kind = 'room') then return new; end if;
  if private.is_hotel(new.restaurant_id) and not private.service_open(new.restaurant_id) then
    raise exception using errcode = 'GM025', message = 'service_closed';
  end if;
  return new;
end $$;
revoke all on function private.guard_service_hours_room() from public, anon, authenticated;

drop trigger if exists guard_service_hours on public.requests;
create trigger guard_service_hours before insert on public.requests for each row execute function private.guard_service_hours();
drop trigger if exists guard_service_hours on public.help_requests;
create trigger guard_service_hours before insert on public.help_requests for each row execute function private.guard_service_hours();
drop trigger if exists guard_service_hours on public.orders;
create trigger guard_service_hours before insert on public.orders for each row execute function private.guard_service_hours_room();
drop trigger if exists guard_service_hours on public.service_requests;
create trigger guard_service_hours before insert on public.service_requests for each row execute function private.guard_service_hours_room();

-- owner or manager sets the hours; both empty clears them (open all day)
create or replace function public.padh_service_hours_set(p_start time, p_end time) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  if (p_start is null) <> (p_end is null) or (p_start is not null and p_start = p_end) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.hotel_settings set service_start = p_start, service_end = p_end where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_service_hours_set', 'hotel_settings', v_rid::text, jsonb_build_object('start', p_start, 'end', p_end));
  return jsonb_build_object('service_start', to_char(p_start, 'HH24:MI'), 'service_end', to_char(p_end, 'HH24:MI'));
end $$;
revoke all on function public.padh_service_hours_set(time, time) from public, anon, service_role;
grant execute on function public.padh_service_hours_set(time, time) to authenticated;

-- what a signed-in guest's page needs: are requests open now, and from when to when (only for the guest's own hotel)
create or replace function public.padh_service_hours_guest(p_session uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; h public.hotel_settings;
begin
  select restaurant_id into v_rid from public.guest_sessions where id = p_session;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  return jsonb_build_object('open', private.service_open(v_rid), 'start', to_char(h.service_start, 'HH24:MI'), 'end', to_char(h.service_end, 'HH24:MI'));
end $$;
revoke all on function public.padh_service_hours_guest(uuid) from public, anon, authenticated;
grant execute on function public.padh_service_hours_guest(uuid) to service_role;

create or replace function public.padh_manage_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); h public.hotel_settings; r public.restaurants;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  select * into r from public.restaurants where id = v_rid;
  return jsonb_build_object('brand_color', h.brand_color, 'logo_path', h.logo_path, 'hero_path', h.hero_path, 'tripadvisor_url', h.tripadvisor_url,
    'menu_url', h.menu_url, 'review_link', coalesce(h.review_link, r.review_url), 'offer_text', h.offer_text, 'offer_until', h.offer_until, 'info_text', h.info_text,
    'wifi_name', h.wifi_name, 'checkout_time', h.checkout_time, 'breakfast_text', h.breakfast_text, 'reception_phone', h.reception_phone,
    'manager_phone', h.manager_phone, 'room_dining', h.room_dining, 'kitchen_display', h.kitchen_display, 'instagram', r.instagram_url,
    'service_start', to_char(h.service_start, 'HH24:MI'), 'service_end', to_char(h.service_end, 'HH24:MI'));
end $$;

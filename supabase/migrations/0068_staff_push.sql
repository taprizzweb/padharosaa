-- 0068_staff_push
-- Staff alerts on the phone or the desktop, even when the Padharosaa page is closed or another site is open: a new guest request or a food
-- order sends a push notification to the people who handle it (the team of the request, the person it was given to, reception, manager, owner).
-- A person who muted a team in "My alerts" gets nothing from that team. A device is stored with the person who allowed it; "off" switches it off
-- (nothing is deleted). The message holds only the room, the request and the page to open.
-- Idempotent. Rollback: drop the functions and the table.
create table if not exists public.staff_push (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  endpoint      text not null check (char_length(endpoint) between 20 and 1000),
  sub           jsonb not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (endpoint)
);
create index if not exists staff_push_hotel_idx on public.staff_push (restaurant_id) where active;
alter table public.staff_push enable row level security; -- no policy: reached only through the functions below

-- any signed-in staff member: this device on (p_sub = the browser's subscription as JSON text) or off (p_sub null)
create or replace function public.padh_staff_push_set(p_sub text, p_endpoint text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']); v_sub jsonb; v_ep text;
begin
  if p_sub is null then
    if p_endpoint is null or char_length(p_endpoint) not between 20 and 1000 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
    update public.staff_push set active = false, updated_at = now() where endpoint = p_endpoint and user_id = auth.uid();
    return jsonb_build_object('on', false);
  end if;
  begin v_sub := p_sub::jsonb; exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  v_ep := v_sub->>'endpoint';
  if jsonb_typeof(v_sub) <> 'object' or v_ep is null or v_ep !~ '^https://' or char_length(v_ep) not between 20 and 1000
     or char_length(coalesce(v_sub#>>'{keys,p256dh}', '')) not between 20 and 200 or char_length(coalesce(v_sub#>>'{keys,auth}', '')) not between 8 and 100 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.staff_push where user_id = auth.uid() and active) >= 10 and not exists (select 1 from public.staff_push where endpoint = v_ep) then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  insert into public.staff_push (user_id, restaurant_id, endpoint, sub) values (auth.uid(), v_rid, v_ep, v_sub)
  on conflict (endpoint) do update set user_id = auth.uid(), restaurant_id = v_rid, sub = excluded.sub, active = true, updated_at = now();
  return jsonb_build_object('on', true);
end $$;
revoke all on function public.padh_staff_push_set(text, text) from public, anon, service_role;
grant execute on function public.padh_staff_push_set(text, text) to authenticated;

-- the people who should hear about something of this team. An assigned request goes to that person and to those who oversee everything.
create or replace function private.staff_push_targets(p_rid uuid, p_team text, p_assigned uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', sp.id, 'sub', sp.sub)), '[]'::jsonb)
    from public.staff_push sp
    join public.staff s on s.user_id = sp.user_id and s.restaurant_id = sp.restaurant_id and s.active
    left join public.staff_profiles p on p.user_id = s.user_id
   where sp.restaurant_id = p_rid and sp.active
     and not exists (select 1 from public.staff_alert_prefs a where a.user_id = s.user_id and a.team = p_team and a.muted)
     and (s.role in ('owner','manager')
          or (s.role = 'waiter' and coalesce(p.department, 'front_desk') in ('front_desk','concierge','manager'))
          or (p_assigned is not null and s.user_id = p_assigned)
          or (p_assigned is null and s.role = 'kitchen' and p_team = 'kitchen')
          or (p_assigned is null and s.role = 'waiter' and p.department = p_team))
$$;
revoke all on function private.staff_push_targets(uuid, text, uuid) from public, anon, authenticated;

-- a new request: what to say and whom to tell (null when it is not a hotel request)
create or replace function public.padh_staff_push_for_request(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q public.requests; rm public.rooms; r public.restaurants;
begin
  select * into q from public.requests where id = p_request;
  if not found then return null; end if;
  select * into rm from public.rooms where id = q.room_id;
  select * into r from public.restaurants where id = q.restaurant_id;
  return jsonb_build_object('hotel', r.name, 'room', rm.number, 'type', q.type, 'team', q.team, 'label', q.label, 'urgent', q.urgent, 'id', q.id,
    'targets', private.staff_push_targets(q.restaurant_id, q.team, q.assigned_to));
end $$;
revoke all on function public.padh_staff_push_for_request(uuid) from public, anon, authenticated;
grant execute on function public.padh_staff_push_for_request(uuid) to service_role;

-- a new food order from a hotel room (the kitchen and reception hear it)
create or replace function public.padh_staff_push_for_order(p_slug text, p_order_no bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants; o public.orders; t public.dining_tables;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found or not private.is_hotel(r.id) then return null; end if;
  select * into o from public.orders where restaurant_id = r.id and order_no = p_order_no;
  if not found then return null; end if;
  select * into t from public.dining_tables where id = o.table_id;
  if t.kind is distinct from 'room' then return null; end if;
  return jsonb_build_object('hotel', r.name, 'room', regexp_replace(t.label, '^Room ', ''), 'type', 'order', 'team', 'kitchen', 'label', 'Food order ₹' || (o.total_paise / 100), 'urgent', false, 'id', o.id,
    'targets', private.staff_push_targets(r.id, 'kitchen', null));
end $$;
revoke all on function public.padh_staff_push_for_order(text, bigint) from public, anon, authenticated;
grant execute on function public.padh_staff_push_for_order(text, bigint) to service_role;

-- a device that is gone (the push service said so)
create or replace function public.padh_staff_push_drop(p_id uuid) returns void
language sql security definer set search_path = '' as $$ update public.staff_push set active = false, updated_at = now() where id = p_id $$;
revoke all on function public.padh_staff_push_drop(uuid) from public, anon, authenticated;
grant execute on function public.padh_staff_push_drop(uuid) to service_role;

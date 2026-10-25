-- 0056_assign_and_live_rooms
-- 1. A request can belong to one person ("assigned"): reception hands it over from the desk, or the owner/manager sets, for each team, the
--    person who gets that team's requests straight on their own display (routing). An assigned request is seen and handled by that person
--    (whatever their department) and by reception, manager and owner; other people of the same team no longer see it.
-- 2. "Live rooms": every room with a guest, its open requests and the amount not yet settled, for reception, manager and owner.
-- Idempotent. Rollback: drop the trigger and the functions below, drop the table request_routing and the two columns, and restore
-- requests_select, request_events_select, lock_request (0036) and padh_staff_board (0049).
alter table public.requests add column if not exists assigned_to uuid references auth.users (id) on delete set null;
alter table public.requests add column if not exists assigned_at timestamptz;
grant select (assigned_to, assigned_at) on public.requests to authenticated; -- the row policies read them
create index if not exists requests_assigned_idx on public.requests (restaurant_id, assigned_to) where assigned_to is not null;

create table if not exists public.request_routing (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  team          text not null check (team in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager')),
  user_id       uuid not null references auth.users (id) on delete cascade,
  updated_at    timestamptz not null default now(),
  primary key (restaurant_id, team)
);
alter table public.request_routing enable row level security; -- no policy: reached only through the functions below

-- reception, concierge, managers and owners oversee every request of the hotel
create or replace function private.sees_everything() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.my_role() in ('owner','manager') or (private.my_role() = 'waiter' and coalesce(private.my_department(), 'front_desk') in ('front_desk','concierge','manager'))
$$;
revoke all on function private.sees_everything() from public, anon;
grant execute on function private.sees_everything() to authenticated;

-- may the caller see and act on a request of this team that is assigned to this person (or to nobody)
create or replace function private.can_handle(p_team text, p_assigned uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_assigned is not null and p_assigned = auth.uid())
      or (private.can_act_team(p_team) and (p_assigned is null or private.sees_everything()))
$$;
revoke all on function private.can_handle(text, uuid) from public, anon;
grant execute on function private.can_handle(text, uuid) to authenticated;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and private.can_handle(team, assigned_to));
drop policy if exists request_events_select on public.request_events;
create policy request_events_select on public.request_events for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
         and exists (select 1 from public.requests q where q.id = request_events.request_id and q.restaurant_id = request_events.restaurant_id and private.can_handle(q.team, q.assigned_to)));

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
  if not private.can_handle(q.team, q.assigned_to) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  if p_version is null or q.version <> p_version then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  return q;
end $$;

-- routing: a new request (or one passed to another team) goes straight to the person set for its team, if there is one
create or replace function private.padh_route_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if tg_op = 'INSERT' and new.assigned_to is not null then return new; end if;
  select r.user_id into v_user from public.request_routing r join public.staff s on s.user_id = r.user_id and s.restaurant_id = r.restaurant_id and s.active
   where r.restaurant_id = new.restaurant_id and r.team = new.team;
  new.assigned_to := v_user;
  new.assigned_at := case when v_user is null then null else now() end;
  return new;
end $$;
create or replace trigger padh_route_request_ins before insert on public.requests for each row execute function private.padh_route_request();
create or replace trigger padh_route_request_team before update of team on public.requests for each row when (new.team is distinct from old.team) execute function private.padh_route_request();

-- the people a request can be handed to (reception, manager, owner)
create or replace function public.padh_assignees() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
begin
  if not private.sees_everything() then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'name', s.display_name, 'role', s.role, 'department', p.department) order by s.display_name)
    from public.staff s left join public.staff_profiles p on p.user_id = s.user_id
   where s.restaurant_id = v_rid and s.active and s.role in ('waiter','manager','owner')), '[]'::jsonb);
end $$;
revoke all on function public.padh_assignees() from public, anon, service_role;
grant execute on function public.padh_assignees() to authenticated;

-- hand a request to one person (or back to its team with null)
create or replace function public.padh_request_assign(p_request uuid, p_version int, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); q public.requests; v_name text;
begin
  if not private.sees_everything() then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  select * into q from public.requests where id = p_request and restaurant_id = v_rid for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if p_version is null or q.version <> p_version then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  if q.status not in ('received','accepted','preparing','ready') then raise exception using errcode = 'GM010', message = 'invalid_transition'; end if;
  if p_user is not null then
    select display_name into v_name from public.staff where user_id = p_user and restaurant_id = v_rid and active and role in ('waiter','manager','owner');
    if not found then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  end if;
  update public.requests set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end, version = version + 1, updated_at = now()
   where id = q.id returning * into q;
  perform private.req_event(q, 'staff', auth.uid(), 'assigned', jsonb_build_object('to', p_user, 'name', v_name));
  perform private.write_audit(v_rid, 'padh_request_assign', 'requests', q.id::text, jsonb_build_object('to', p_user));
  return jsonb_build_object('assigned_to', p_user, 'assigned_name', v_name, 'version', q.version);
end $$;
revoke all on function public.padh_request_assign(uuid, int, uuid) from public, anon, service_role;
grant execute on function public.padh_request_assign(uuid, int, uuid) to authenticated;

-- routing settings (owner, manager): who gets each team's requests directly
create or replace function public.padh_routing_get() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  return coalesce((select jsonb_object_agg(r.team, r.user_id) from public.request_routing r where r.restaurant_id = v_rid), '{}'::jsonb);
end $$;
create or replace function public.padh_routing_set(p_team text, p_user uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  if p_team is null or p_team not in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager') then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if p_user is null then
    delete from public.request_routing where restaurant_id = v_rid and team = p_team;
  else
    if not exists (select 1 from public.staff where user_id = p_user and restaurant_id = v_rid and active and role in ('waiter','manager','owner')) then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
    insert into public.request_routing (restaurant_id, team, user_id) values (v_rid, p_team, p_user)
    on conflict (restaurant_id, team) do update set user_id = excluded.user_id, updated_at = now();
  end if;
  perform private.write_audit(v_rid, 'padh_routing_set', 'request_routing', p_team, jsonb_build_object('user', p_user));
  return jsonb_build_object('team', p_team, 'user_id', p_user);
end $$;
revoke all on function public.padh_routing_get(), public.padh_routing_set(text, uuid) from public, anon, service_role;
grant execute on function public.padh_routing_get(), public.padh_routing_set(text, uuid) to authenticated;

-- the desk's list: assigned person included, and what each caller may see
create or replace function public.padh_staff_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']); v_role text := private.my_role();
  v_teams text[] := array(select t from unnest(array['concierge','front_desk','housekeeping','kitchen','maintenance','manager']) t where private.can_act_team(t));
  v_all boolean := private.sees_everything(); v_me uuid := auth.uid();
begin
  return jsonb_build_object('role', v_role, 'me', v_me, 'requests', coalesce((
    select jsonb_agg(row_to_json(x) order by x.urgent desc, x.created_at desc) from (
      select q.id, q.type, q.team, q.label, q.detail, q.urgent, q.status, q.dismissed_reason, q.resolution, q.handover, q.prep_minutes, q.version, q.created_at, q.accepted_at, q.completed_at, q.parent_request_id,
             q.assigned_to, (select s.display_name from public.staff s where s.user_id = q.assigned_to) as assigned_name,
             rm.number as room, g.guest_name, g.diet, g.occasion, g.language, case when v_role = 'kitchen' then null else encode(g.mobile_enc, 'hex') end as mobile_enc, g.mobile_cc,
             (select count(*) from public.guest_sessions g2 where g2.restaurant_id = q.restaurant_id and g2.room_id = q.room_id and g2.status = 'active') as guests_in_room
        from public.requests q join public.rooms rm on rm.id = q.room_id join public.guest_sessions g on g.id = q.session_id
       where q.restaurant_id = v_rid
         and ((q.assigned_to = v_me) or (q.team = any (v_teams) and (q.assigned_to is null or v_all)))
         and (q.status in ('received','accepted','preparing','ready') or q.updated_at > now() - interval '12 hours')
       order by q.urgent desc, q.created_at desc limit 200) x), '[]'::jsonb));
end $$;

-- live rooms: every room with a guest, its open requests and orders, and the amount not yet settled (reception, manager, owner)
create or replace function public.padh_live_rooms() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
begin
  if not private.sees_everything() then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  return coalesce((select jsonb_agg(x order by x.number) from (
    select rm.id, rm.number,
           (select min(g.guest_name) from public.guest_sessions g where g.restaurant_id = rm.restaurant_id and g.room_id = rm.id and g.status = 'active') as guest_name,
           (select count(*) from public.guest_sessions g where g.restaurant_id = rm.restaurant_id and g.room_id = rm.id and g.status = 'active') as guests,
           (select count(*) from public.requests q where q.restaurant_id = rm.restaurant_id and q.room_id = rm.id and q.status in ('received','accepted','preparing','ready')) as open_requests,
           (select count(*) from public.dining_tables t join public.table_sessions ts on ts.table_id = t.id and ts.restaurant_id = t.restaurant_id and ts.closed_at is null
              join public.orders o on o.session_id = ts.id and o.restaurant_id = ts.restaurant_id and o.status in ('placed','preparing','ready')
             where t.restaurant_id = rm.restaurant_id and t.kind = 'room' and t.label = 'Room ' || upper(rm.number)) as open_orders,
           (select coalesce(sum(o.total_paise), 0)::int from public.dining_tables t join public.table_sessions ts on ts.table_id = t.id and ts.restaurant_id = t.restaurant_id and ts.closed_at is null
              join public.orders o on o.session_id = ts.id and o.restaurant_id = ts.restaurant_id and o.status <> 'cancelled'
             where t.restaurant_id = rm.restaurant_id and t.kind = 'room' and t.label = 'Room ' || upper(rm.number)) as unpaid_paise
      from public.rooms rm
     where rm.restaurant_id = v_rid and exists (select 1 from public.guest_sessions g where g.restaurant_id = rm.restaurant_id and g.room_id = rm.id and g.status = 'active')) x), '[]'::jsonb);
end $$;
revoke all on function public.padh_live_rooms() from public, anon, service_role;
grant execute on function public.padh_live_rooms() to authenticated;

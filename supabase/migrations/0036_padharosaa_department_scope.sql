-- 0036_padharosaa_department_scope
-- A person whose department is housekeeping or maintenance sees and acts on THEIR team's requests only (reception, concierge, managers
-- and owners see everything; kitchen stays kitchen only). The check lives in one function used by the row-level policies, the board,
-- every state change and the alert settings, so no screen can show more than the database allows.
-- Idempotent. Rollback: restore the functions and policies from 0027, 0031 and 0032 (role_can_act based).

create or replace function private.my_department() returns text
language sql stable security definer set search_path = '' as $$
  select p.department from public.staff_profiles p where p.user_id = auth.uid()
$$;
revoke all on function private.my_department() from public, anon;
grant execute on function private.my_department() to authenticated;

create or replace function private.can_act_team(p_team text) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.role_can_act(private.my_role(), p_team)
     and (private.my_role() in ('owner','manager') or coalesce(private.my_department(), 'front_desk') in ('front_desk','concierge','manager')
          or private.my_department() = p_team)
$$;
revoke all on function private.can_act_team(text) from public, anon;
grant execute on function private.can_act_team(text) to authenticated;

drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and private.can_act_team(team));
drop policy if exists request_events_select on public.request_events;
create policy request_events_select on public.request_events for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
         and exists (select 1 from public.requests q where q.id = request_events.request_id and q.restaurant_id = request_events.restaurant_id and private.can_act_team(q.team)));

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
  if not private.can_act_team(q.team) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  if p_version is null or q.version <> p_version then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  return q;
end $$;

create or replace function public.padh_staff_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']); v_role text := private.my_role();
begin
  return jsonb_build_object('role', v_role, 'requests', coalesce((
    select jsonb_agg(row_to_json(x) order by x.urgent desc, x.created_at desc) from (
      select q.id, q.type, q.team, q.label, q.detail, q.urgent, q.status, q.dismissed_reason, q.resolution, q.handover, q.prep_minutes, q.version, q.created_at, q.accepted_at, q.parent_request_id,
             rm.number as room, g.guest_name, g.diet, g.occasion, g.language, case when v_role = 'kitchen' then null else encode(g.mobile_enc, 'hex') end as mobile_enc, g.mobile_cc,
             (select count(*) from public.guest_sessions g2 where g2.restaurant_id = q.restaurant_id and g2.room_id = q.room_id and g2.status = 'active') as guests_in_room
        from public.requests q join public.rooms rm on rm.id = q.room_id join public.guest_sessions g on g.id = q.session_id
       where q.restaurant_id = v_rid and private.can_act_team(q.team)
         and (q.status in ('received','accepted','preparing','ready') or q.updated_at > now() - interval '12 hours')
       order by q.urgent desc, q.created_at desc limit 200) x), '[]'::jsonb));
end $$;

create or replace function public.padh_my_alerts() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']); v_role text := private.my_role();
begin
  return jsonb_build_object('room_dining', (select room_dining from public.hotel_settings where restaurant_id = v_rid),
    'muted', coalesce((select jsonb_agg(a.team) from public.staff_alert_prefs a where a.user_id = auth.uid() and a.muted), '[]'::jsonb),
    'teams', (select jsonb_agg(t) from unnest(array['concierge','front_desk','housekeeping','kitchen','maintenance','manager']) t where private.can_act_team(t)));
end $$;

create or replace function public.padh_set_my_alert(p_team text, p_muted boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']);
begin
  if p_team is null or p_muted is null or p_team not in ('concierge','front_desk','housekeeping','kitchen','maintenance','manager') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not private.can_act_team(p_team) then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  insert into public.staff_alert_prefs (user_id, team, muted) values (auth.uid(), p_team, p_muted)
  on conflict (user_id, team) do update set muted = excluded.muted;
  return jsonb_build_object('team', p_team, 'muted', p_muted);
end $$;

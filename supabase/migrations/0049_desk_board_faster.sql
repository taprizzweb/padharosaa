-- 0049_desk_board_faster
-- The reception desk board asked "may this person act on this team?" once per request row, and each answer looked up the person's role
-- and department several times. In a big hotel with many requests in the last 12 hours that was the slowest call of the whole app (found by
-- the load test). The answer only depends on the team, so it is worked out ONCE for the six teams and the rows are matched against that list.
-- Same rows, same order, same columns. Idempotent. Rollback: restore padh_staff_board from 0036.
create or replace function public.padh_staff_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter','kitchen']); v_role text := private.my_role();
  v_teams text[] := array(select t from unnest(array['concierge','front_desk','housekeeping','kitchen','maintenance','manager']) t where private.can_act_team(t));
begin
  return jsonb_build_object('role', v_role, 'requests', coalesce((
    select jsonb_agg(row_to_json(x) order by x.urgent desc, x.created_at desc) from (
      select q.id, q.type, q.team, q.label, q.detail, q.urgent, q.status, q.dismissed_reason, q.resolution, q.handover, q.prep_minutes, q.version, q.created_at, q.accepted_at, q.parent_request_id,
             rm.number as room, g.guest_name, g.diet, g.occasion, g.language, case when v_role = 'kitchen' then null else encode(g.mobile_enc, 'hex') end as mobile_enc, g.mobile_cc,
             (select count(*) from public.guest_sessions g2 where g2.restaurant_id = q.restaurant_id and g2.room_id = q.room_id and g2.status = 'active') as guests_in_room
        from public.requests q join public.rooms rm on rm.id = q.room_id join public.guest_sessions g on g.id = q.session_id
       where q.restaurant_id = v_rid and q.team = any (v_teams)
         and (q.status in ('received','accepted','preparing','ready') or q.updated_at > now() - interval '12 hours')
       order by q.urgent desc, q.created_at desc limit 200) x), '[]'::jsonb));
end $$;

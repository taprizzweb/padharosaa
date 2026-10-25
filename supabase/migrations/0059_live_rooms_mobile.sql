-- 0059_live_rooms_mobile
-- The live rooms list shows, with each room, the name and the mobile number of the guest who signed in to it (the earliest active session).
-- The number stays encrypted in the database; the app decrypts it for reception, manager and owner only (same rule as the desk list).
-- Idempotent. Rollback: restore padh_live_rooms from 0056.
-- live rooms: every room with a guest, its open requests and orders, and the amount not yet settled (reception, manager, owner)
create or replace function public.padh_live_rooms() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
begin
  if not private.sees_everything() then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  return coalesce((select jsonb_agg(x order by x.number) from (
    select rm.id, rm.number,
           (select g.guest_name from public.guest_sessions g where g.restaurant_id = rm.restaurant_id and g.room_id = rm.id and g.status = 'active' order by g.started_at limit 1) as guest_name,
           (select encode(g.mobile_enc, 'hex') from public.guest_sessions g where g.restaurant_id = rm.restaurant_id and g.room_id = rm.id and g.status = 'active' order by g.started_at limit 1) as mobile_enc,
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

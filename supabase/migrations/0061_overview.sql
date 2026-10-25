-- 0061_overview
-- The owner's and manager's Overview: today at a glance for the hotel (guests in, requests and how fast they are answered, food orders, the
-- busiest hours, the last seven days). Read-only; amounts exclude GST and charges (they are the dish prices as ordered).
-- Idempotent. Rollback: drop function public.padh_overview().
create or replace function public.padh_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_hotel_staff(array['owner','manager']); h public.hotel_settings; v_tz text; v_today date; v_start timestamptz;
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  v_tz := coalesce(h.timezone, 'Asia/Kolkata');
  begin v_today := (now() at time zone v_tz)::date; exception when others then v_tz := 'Asia/Kolkata'; v_today := (now() at time zone v_tz)::date; end;
  v_start := (v_today::timestamp at time zone v_tz);
  return jsonb_build_object(
    'today', v_today,
    'guests_in', (select count(*) from public.guest_sessions g where g.restaurant_id = v_rid and g.status = 'active'),
    'rooms_with_guests', (select count(distinct g.room_id) from public.guest_sessions g where g.restaurant_id = v_rid and g.status = 'active'),
    'requests_today', (select count(*) from public.requests q where q.restaurant_id = v_rid and q.created_at >= v_start and q.type not in ('chat_message','feedback_alert')),
    'open_now', (select count(*) from public.requests q where q.restaurant_id = v_rid and q.status in ('received','accepted','preparing','ready')),
    'waiting_now', (select count(*) from public.requests q where q.restaurant_id = v_rid and q.status = 'received'),
    'urgent_today', (select count(*) from public.requests q where q.restaurant_id = v_rid and q.created_at >= v_start and q.urgent),
    'done_today', (select count(*) from public.requests q where q.restaurant_id = v_rid and q.created_at >= v_start and q.status = 'completed'),
    'avg_accept_minutes', (select round((avg(extract(epoch from (q.accepted_at - q.created_at))) / 60)::numeric, 1) from public.requests q where q.restaurant_id = v_rid and q.created_at >= v_start and q.accepted_at is not null),
    'avg_done_minutes', (select round((avg(extract(epoch from (q.completed_at - q.created_at))) / 60)::numeric, 1) from public.requests q where q.restaurant_id = v_rid and q.created_at >= v_start and q.completed_at is not null),
    'orders_today', (select count(*) from public.orders o where o.restaurant_id = v_rid and o.created_at >= v_start and o.status <> 'cancelled'),
    'orders_paise_today', (select coalesce(sum(o.total_paise), 0)::bigint from public.orders o where o.restaurant_id = v_rid and o.created_at >= v_start and o.status <> 'cancelled'),
    'by_type', coalesce((select jsonb_agg(jsonb_build_object('type', t.type, 'n', t.n) order by t.n desc, t.type) from (
        select q.type, count(*) n from public.requests q where q.restaurant_id = v_rid and q.created_at >= v_start and q.type not in ('chat_message','feedback_alert') group by q.type order by count(*) desc limit 6) t), '[]'::jsonb),
    'by_hour', coalesce((select jsonb_agg(coalesce(c.n, 0) order by hr) from generate_series(0, 23) hr
        left join (select extract(hour from (q.created_at at time zone v_tz))::int hh, count(*) n from public.requests q where q.restaurant_id = v_rid and q.created_at >= v_start and q.type not in ('chat_message','feedback_alert') group by 1) c on c.hh = hr), '[]'::jsonb),
    'last_days', coalesce((select jsonb_agg(jsonb_build_object('date', d::date, 'n', coalesce(c.n, 0)) order by d) from generate_series((v_today - 6)::timestamp, v_today::timestamp, interval '1 day') d
        left join (select (q.created_at at time zone v_tz)::date dd, count(*) n from public.requests q where q.restaurant_id = v_rid and q.created_at >= ((v_today - 6)::timestamp at time zone v_tz) and q.type not in ('chat_message','feedback_alert') group by 1) c on c.dd = d::date), '[]'::jsonb)
  );
end $$;
revoke all on function public.padh_overview() from public, anon, service_role;
grant execute on function public.padh_overview() to authenticated;

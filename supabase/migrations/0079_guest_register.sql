-- 0079_guest_register
-- The guest register (entry register) for the front desk: for every day in a range, who was in the hotel, who arrived, who left, and what each guest asked for or
-- complained about that day. Read-only; it reads the stays, the guests' requests (housekeeping, help, food, complaints...) and the invoice total.
-- Reception, manager and owner can read it. At most 31 days at a time.
-- Idempotent. Rollback: drop function public.padh_guest_register(date, date).
create or replace function public.padh_guest_register(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_tz text; v_today date;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 30 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from public.hotel_settings where restaurant_id = v_rid;
  v_tz := coalesce(v_tz, 'Asia/Kolkata');
  v_today := (now() at time zone v_tz)::date;
  return jsonb_build_object('from', p_from, 'to', p_to, 'days', coalesce((
    select jsonb_agg(jsonb_build_object('day', dd.d, 'arrivals', x.arrivals, 'departures', x.departures, 'in_hotel', x.in_hotel, 'guests', x.guests) order by dd.d)
      from (select g::date as d from generate_series(p_from, p_to, interval '1 day') g) dd
      cross join lateral (
        select count(*) filter (where a.arrived) as arrivals, count(*) filter (where a.left_today) as departures, count(*) as in_hotel,
               coalesce(jsonb_agg(jsonb_build_object(
                 'stay_id', a.id, 'room', a.room, 'name', a.guest_name, 'mobile', a.mobile, 'id_type', a.id_type, 'id_last4', a.id_last4, 'adults', a.adults, 'company', a.company_name,
                 'check_in_at', a.check_in_at, 'checked_out_at', a.checked_out_at, 'arrived', a.arrived, 'left', a.left_today,
                 'total_paise', a.total, 'invoice', a.invoice,
                 'requests', coalesce((select jsonb_agg(jsonb_build_object('at', q.created_at, 'label', q.label, 'detail', q.detail, 'status', q.status, 'urgent', q.urgent, 'team', q.team, 'resolution', q.resolution) order by q.created_at)
                                         from (select r.* from public.requests r where r.restaurant_id = v_rid and r.room_id = a.room_id and r.type <> 'chat_message'
                                                  and r.created_at >= a.check_in_at and (a.checked_out_at is null or r.created_at <= a.checked_out_at + interval '1 hour')
                                                  and (r.created_at at time zone v_tz)::date = dd.d order by r.created_at limit 40) q), '[]'::jsonb)
               ) order by a.room), '[]'::jsonb) as guests
          from (
            select s.*, rm.number as room, (s.check_in_at at time zone v_tz)::date = dd.d as arrived,
                   s.checked_out_at is not null and (s.checked_out_at at time zone v_tz)::date = dd.d as left_today,
                   (i.snapshot->'folio'->>'total_paise')::bigint as total, i.number as invoice
              from public.stays s join public.rooms rm on rm.id = s.room_id left join public.invoices i on i.stay_id = s.id
             where s.restaurant_id = v_rid and (s.check_in_at at time zone v_tz)::date <= dd.d
               and dd.d <= case when s.checked_out_at is not null then (s.checked_out_at at time zone v_tz)::date else v_today end
          ) a) x), '[]'::jsonb));
end $$;
revoke all on function public.padh_guest_register(date, date) from public, anon, service_role;
grant execute on function public.padh_guest_register(date, date) to authenticated;

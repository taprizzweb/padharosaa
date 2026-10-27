-- 0074_rates
-- A price calendar for every room type. The room type's own rate is the everyday price; the owner or manager can set a different price,
-- a stop-sell or a minimum stay for any day, one day or a whole range (optionally only on some weekdays). The calendar also shows how many
-- rooms of the type are still free each day. Nothing here changes a guest's bill: a stay keeps the rate it was checked in with.
-- RLS is on with no policy: the app reaches the data only through the functions below. Idempotent.
-- A day that is put back to the everyday price keeps an empty row; it holds nothing and changes nothing.
-- Rollback: drop the functions, then room_rates.
create table if not exists public.room_rates (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  room_type_id  uuid not null,
  day           date not null,
  rate_paise    int check (rate_paise is null or rate_paise between 0 and 10000000),
  stop_sell     boolean not null default false,
  min_stay      int check (min_stay is null or min_stay between 1 and 30),
  updated_at    timestamptz not null default now(),
  primary key (room_type_id, day),
  constraint room_rates_type_fk foreign key (room_type_id, restaurant_id) references public.room_types (id, restaurant_id) on delete cascade
);
create index if not exists room_rates_hotel_idx on public.room_rates (restaurant_id, day);
alter table public.room_rates enable row level security;

-- how many rooms of a type can still be sold on a day: the rooms in service, less the guests in them and the bookings that hold one
create or replace function private.type_free(p_rid uuid, p_type uuid, p_day date) returns int
language sql stable security definer set search_path = '' as $$
  select greatest(0,
    (select count(*) from public.rooms r where r.restaurant_id = p_rid and r.room_type_id = p_type and r.active and r.hk_status <> 'out_of_order')::int
    - (select count(*) from public.stays s join public.rooms r on r.id = s.room_id
        where s.restaurant_id = p_rid and r.room_type_id = p_type and s.status = 'in_house'
          and (s.check_in_at at time zone coalesce((select timezone from public.hotel_settings where restaurant_id = p_rid), 'Asia/Kolkata'))::date <= p_day
          and (p_day < s.check_out_on or p_day = private.hotel_today(p_rid)))::int
    - (select count(*) from public.reservations v where v.restaurant_id = p_rid and v.room_type_id = p_type and v.status = 'booked' and v.check_in_on <= p_day and p_day < v.check_out_on)::int)
$$;
revoke all on function private.type_free(uuid, uuid, date) from public, anon, authenticated;

-- the price a room type is sold at on a day
create or replace function private.type_rate(p_type uuid, p_day date) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce((select rr.rate_paise from public.room_rates rr where rr.room_type_id = p_type and rr.day = p_day), (select rate_paise from public.room_types where id = p_type))
$$;
revoke all on function private.type_rate(uuid, date) from public, anon, authenticated;

-- reception and up can read the calendar; the price edits below are for the owner and manager
create or replace function public.padh_rates_get(p_type uuid, p_from date, p_days int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); t public.room_types; v_from date := coalesce(p_from, private.hotel_today(v_rid)); v_days int := coalesce(p_days, 31);
begin
  if v_days not between 1 and 62 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into t from public.room_types where id = p_type and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  return jsonb_build_object(
    'type', jsonb_build_object('id', t.id, 'name', t.name, 'base_paise', t.rate_paise,
      'rooms', (select count(*) from public.rooms where restaurant_id = v_rid and room_type_id = t.id and active)),
    'today', private.hotel_today(v_rid), 'from', v_from,
    'days', (select jsonb_agg(jsonb_build_object('day', d::date, 'rate_paise', coalesce(rr.rate_paise, t.rate_paise), 'custom', rr.rate_paise is not null, 'stop_sell', coalesce(rr.stop_sell, false),
        'min_stay', rr.min_stay, 'free', private.type_free(v_rid, t.id, d::date)) order by d)
      from generate_series(v_from, v_from + (v_days - 1), interval '1 day') d left join public.room_rates rr on rr.room_type_id = t.id and rr.day = d::date));
end $$;
revoke all on function public.padh_rates_get(uuid, date, int) from public, anon, service_role;
grant execute on function public.padh_rates_get(uuid, date, int) to authenticated;

-- p_rate / p_stop / p_min: null leaves that part as it is (p_min 0 removes the minimum stay). p_reset: put the days back to the everyday price.
-- p_weekdays: for example 'sat,sun'; null means every day of the range.
create or replace function public.padh_rates_set(p_type uuid, p_from date, p_to date, p_rate int, p_stop boolean, p_min int, p_weekdays text, p_reset boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_today date := private.hotel_today(v_rid); v_wd int[]; v_n int := 0; w text;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 or p_from < v_today - 1 or coalesce(p_reset, false) is null
     or (p_rate is not null and p_rate not between 0 and 10000000) or (p_min is not null and p_min not between 0 and 30)
     or (not coalesce(p_reset, false) and p_rate is null and p_stop is null and p_min is null) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.room_types where id = p_type and restaurant_id = v_rid) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if p_weekdays is not null and btrim(p_weekdays) <> '' then
    foreach w in array string_to_array(lower(regexp_replace(p_weekdays, '\s', '', 'g')), ',') loop
      v_wd := v_wd || (case w when 'mon' then 1 when 'tue' then 2 when 'wed' then 3 when 'thu' then 4 when 'fri' then 5 when 'sat' then 6 when 'sun' then 7 else null end);
    end loop;
    if exists (select 1 from unnest(v_wd) x where x is null) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  end if;
  if not private.rl_hit('padh_rates:' || v_rid::text, 400, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  if coalesce(p_reset, false) then
    -- back to the everyday price: the day's row is kept but holds nothing (no price, open for sale, no minimum stay)
    update public.room_rates set rate_paise = null, stop_sell = false, min_stay = null, updated_at = now()
     where room_type_id = p_type and restaurant_id = v_rid and day between p_from and p_to and (v_wd is null or extract(isodow from day)::int = any (v_wd));
    get diagnostics v_n = row_count;
  else
    insert into public.room_rates (restaurant_id, room_type_id, day, rate_paise, stop_sell, min_stay)
    select v_rid, p_type, d::date, p_rate, coalesce(p_stop, false), nullif(p_min, 0)
      from generate_series(p_from, p_to, interval '1 day') d where v_wd is null or extract(isodow from d)::int = any (v_wd)
    on conflict (room_type_id, day) do update set
      rate_paise = coalesce(p_rate, public.room_rates.rate_paise),
      stop_sell = coalesce(p_stop, public.room_rates.stop_sell),
      min_stay = case when p_min is null then public.room_rates.min_stay else nullif(p_min, 0) end,
      updated_at = now();
    get diagnostics v_n = row_count;
  end if;
  perform private.write_audit(v_rid, 'padh_rates_set', 'room_types', p_type::text, jsonb_build_object('from', p_from, 'to', p_to, 'rate_paise', p_rate, 'stop', p_stop, 'min', p_min, 'reset', coalesce(p_reset, false), 'days', v_n));
  return jsonb_build_object('days', v_n);
end $$;
revoke all on function public.padh_rates_set(uuid, date, date, int, boolean, int, text, boolean) from public, anon, service_role;
grant execute on function public.padh_rates_set(uuid, date, date, int, boolean, int, text, boolean) to authenticated;

-- the booking form asks for the price of a type (or a room) on the arrival day
create or replace function public.padh_rate_on(p_type uuid, p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff();
begin
  if not exists (select 1 from public.room_types where id = p_type and restaurant_id = v_rid) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  return jsonb_build_object('rate_paise', private.type_rate(p_type, p_day));
end $$;
revoke all on function public.padh_rate_on(uuid, date) from public, anon, service_role;
grant execute on function public.padh_rate_on(uuid, date) to authenticated;

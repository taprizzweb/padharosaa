-- 0071_reservations_rooms
-- Front office, step 2: advance bookings, the room chart and housekeeping status.
-- A reservation is a promise of a room for some nights: it can name a room, or only a room type (the room is chosen at check-in). Checking a
-- reservation in creates the stay (and the advance becomes the stay's first payment). Each room carries a housekeeping status that turns to
-- "dirty" by itself when a guest checks out. RLS is on with no policy: the app reaches the data only through the functions below.
-- Idempotent. Rollback: drop the functions, the trigger, the reservations table and the added room columns.
alter table public.rooms add column if not exists hk_status text not null default 'clean' check (hk_status in ('clean','dirty','cleaning','out_of_order'));
alter table public.rooms add column if not exists hk_note text check (hk_note is null or char_length(hk_note) <= 120);
alter table public.rooms add column if not exists hk_updated_at timestamptz;

create table if not exists public.reservations (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  seq           int not null,
  room_id       uuid,
  room_type_id  uuid references public.room_types (id) on delete set null,
  guest_name    text not null check (char_length(guest_name) between 2 and 80),
  mobile        text check (mobile is null or mobile ~ '^[0-9]{10,15}$'),
  adults        int not null default 1 check (adults between 1 and 20),
  check_in_on   date not null,
  check_out_on  date not null,
  rate_paise    int not null check (rate_paise between 0 and 10000000),
  advance_paise int not null default 0 check (advance_paise between 0 and 100000000),
  advance_mode  text check (advance_mode is null or advance_mode in ('cash','card','upi','bank','company')),
  source        text check (source is null or char_length(source) <= 40),
  notes         text check (notes is null or char_length(notes) <= 300),
  status        text not null default 'booked' check (status in ('booked','checked_in','cancelled','no_show')),
  stay_id       uuid references public.stays (id) on delete set null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 200),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint reservations_dates check (check_out_on > check_in_on and check_out_on <= check_in_on + 90),
  constraint reservations_advance_mode check (advance_paise = 0 or advance_mode is not null),
  constraint reservations_room_fk foreign key (room_id, restaurant_id) references public.rooms (id, restaurant_id),
  unique (restaurant_id, seq)
);
create index if not exists reservations_hotel_idx on public.reservations (restaurant_id, status, check_in_on);
alter table public.reservations enable row level security;

-- a guest who checks out leaves the room dirty (unless it is already switched off for repair)
create or replace function private.room_dirty_on_checkout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'checked_out' and old.status <> 'checked_out' then
    update public.rooms set hk_status = 'dirty', hk_updated_at = now() where id = new.room_id and hk_status <> 'out_of_order';
  end if;
  return new;
end $$;
revoke all on function private.room_dirty_on_checkout() from public, anon, authenticated;
drop trigger if exists stays_room_dirty on public.stays;
create trigger stays_room_dirty after update of status on public.stays for each row execute function private.room_dirty_on_checkout();

create or replace function private.hotel_today(p_rid uuid) returns date
language plpgsql stable security definer set search_path = '' as $$
declare v_tz text;
begin
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from public.hotel_settings where restaurant_id = p_rid;
  begin return (now() at time zone coalesce(v_tz, 'Asia/Kolkata'))::date; exception when others then return (now() at time zone 'Asia/Kolkata')::date; end;
end $$;
revoke all on function private.hotel_today(uuid) from public, anon, authenticated;

-- is the room free for [p_in, p_out)? a guest in the room blocks it until their last night; another booking blocks it for its dates
create or replace function private.room_free(p_rid uuid, p_room uuid, p_in date, p_out date, p_except uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.reservations r where r.restaurant_id = p_rid and r.room_id = p_room and r.status = 'booked' and r.id is distinct from p_except and r.check_in_on < p_out and r.check_out_on > p_in)
     and not exists (select 1 from public.stays s where s.restaurant_id = p_rid and s.room_id = p_room and s.status = 'in_house' and s.check_out_on > p_in)
     and not exists (select 1 from public.rooms rm where rm.id = p_room and rm.hk_status = 'out_of_order')
$$;
revoke all on function private.room_free(uuid, uuid, date, date, uuid) from public, anon, authenticated;

-- ---------- reservations ----------
-- p_id null = a new booking. Only a booking that has not arrived can be changed.
create or replace function public.padh_reservation_save(
  p_id uuid, p_room uuid, p_type uuid, p_guest text, p_mobile text, p_adults int, p_in date, p_out date, p_rate_paise int, p_advance_paise int, p_advance_mode text, p_source text, p_notes text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.billing_staff(); v_name text := private.bill_text(p_guest); v_mobile text := nullif(regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g'), '');
  v_today date := private.hotel_today(v_rid); v_type uuid := p_type; v_rate int := p_rate_paise; v_adv int := coalesce(p_advance_paise, 0); v_seq int; v_id uuid;
  v_source text := private.bill_text(p_source); v_notes text := private.bill_text(p_notes);
begin
  if p_room is not null then
    select room_type_id into v_type from public.rooms where id = p_room and restaurant_id = v_rid and active;
    if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  elsif v_type is not null and not exists (select 1 from public.room_types where id = v_type and restaurant_id = v_rid) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if v_rate is null and v_type is not null then select rate_paise into v_rate from public.room_types where id = v_type; end if;
  if v_name is null or char_length(v_name) not between 2 and 80 or (v_mobile is not null and v_mobile !~ '^[0-9]{10,15}$') or coalesce(p_adults, 1) not between 1 and 20
     or p_in is null or p_out is null or p_in < v_today or p_out <= p_in or p_out > p_in + 90 or p_in > v_today + 730
     or v_rate is null or v_rate not between 0 and 10000000 or v_adv not between 0 and 100000000 or (v_adv > 0 and coalesce(p_advance_mode, '') not in ('cash','card','upi','bank','company'))
     or (v_source is not null and char_length(v_source) > 40) or (v_notes is not null and char_length(v_notes) > 300) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not private.rl_hit('padh_reservation:' || v_rid::text, 300, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  if p_room is not null and not private.room_free(v_rid, p_room, p_in, p_out, p_id) then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  if p_id is null then
    perform pg_advisory_xact_lock(hashtext('padh_res:' || v_rid::text));
    select coalesce(max(seq), 0) + 1 into v_seq from public.reservations where restaurant_id = v_rid;
    insert into public.reservations (restaurant_id, seq, room_id, room_type_id, guest_name, mobile, adults, check_in_on, check_out_on, rate_paise, advance_paise, advance_mode, source, notes, created_by)
    values (v_rid, v_seq, p_room, v_type, v_name, v_mobile, coalesce(p_adults, 1), p_in, p_out, v_rate, v_adv, case when v_adv > 0 then p_advance_mode end, v_source, v_notes, auth.uid()) returning id into v_id;
  else
    update public.reservations set room_id = p_room, room_type_id = v_type, guest_name = v_name, mobile = v_mobile, adults = coalesce(p_adults, 1), check_in_on = p_in, check_out_on = p_out,
      rate_paise = v_rate, advance_paise = v_adv, advance_mode = case when v_adv > 0 then p_advance_mode end, source = v_source, notes = v_notes
     where id = p_id and restaurant_id = v_rid and status = 'booked' returning id, seq into v_id, v_seq;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  perform private.write_audit(v_rid, 'padh_reservation_save', 'reservations', v_id::text, jsonb_build_object('in', p_in, 'out', p_out, 'advance_paise', v_adv));
  return jsonb_build_object('id', v_id, 'seq', v_seq);
end $$;
revoke all on function public.padh_reservation_save(uuid, uuid, uuid, text, text, int, date, date, int, int, text, text, text) from public, anon, service_role;
grant execute on function public.padh_reservation_save(uuid, uuid, uuid, text, text, int, date, date, int, int, text, text, text) to authenticated;

-- p_status 'cancelled' or 'no_show'. The advance (if any) stays on record: it is given back by hand and written in the notes.
create or replace function public.padh_reservation_close(p_id uuid, p_status text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_reason text := private.bill_text(p_reason); v_n uuid;
begin
  if p_status not in ('cancelled','no_show') or (v_reason is not null and char_length(v_reason) > 200) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.reservations set status = p_status, cancel_reason = v_reason where id = p_id and restaurant_id = v_rid and status = 'booked' returning id into v_n;
  if v_n is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  perform private.write_audit(v_rid, 'padh_reservation_close', 'reservations', p_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_reservation_close(uuid, text, text) from public, anon, service_role;
grant execute on function public.padh_reservation_close(uuid, text, text) to authenticated;

-- the booking becomes a stay today: the guest's details are filled in from the booking, the advance becomes the first payment
create or replace function public.padh_reservation_checkin(p_id uuid, p_room uuid, p_id_type text, p_id_tail text, p_company text, p_gstin text, p_address text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); r public.reservations; v_today date := private.hotel_today(v_rid); v_out jsonb;
begin
  select * into r from public.reservations where id = p_id and restaurant_id = v_rid and status = 'booked' for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if coalesce(p_room, r.room_id) is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if r.check_in_on > v_today then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if r.check_out_on <= v_today then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  -- a room that is switched off or another booking's room cannot be picked
  if not private.room_free(v_rid, coalesce(p_room, r.room_id), v_today, r.check_out_on, p_id) then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  v_out := public.padh_stay_checkin(coalesce(p_room, r.room_id), r.guest_name, r.mobile, p_id_type, p_id_tail, r.adults, p_company, p_gstin, null, p_address, r.rate_paise, r.check_out_on, r.advance_paise, r.advance_mode);
  update public.reservations set status = 'checked_in', stay_id = (v_out->>'stay_id')::uuid, room_id = coalesce(p_room, r.room_id) where id = p_id;
  return v_out;
end $$;
revoke all on function public.padh_reservation_checkin(uuid, uuid, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.padh_reservation_checkin(uuid, uuid, text, text, text, text, text) to authenticated;

-- p_scope 'upcoming' (booked, not yet arrived), 'today' (arriving today), 'past' (arrived, cancelled, no show: the last 60 days)
create or replace function public.padh_reservations_list(p_scope text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_today date := private.hotel_today(v_rid);
begin
  if p_scope not in ('upcoming','today','past') then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.check_in_on, x.seq) from (
    select r.id, r.seq, r.guest_name, r.mobile, r.adults, r.check_in_on, r.check_out_on, r.rate_paise, r.advance_paise, r.advance_mode, r.source, r.notes, r.status, r.cancel_reason,
           r.room_id, rm.number as room, r.room_type_id, rt.name as room_type, r.stay_id, (r.check_out_on - r.check_in_on) as nights
      from public.reservations r left join public.rooms rm on rm.id = r.room_id left join public.room_types rt on rt.id = r.room_type_id
     where r.restaurant_id = v_rid
       and case p_scope when 'upcoming' then r.status = 'booked' and r.check_out_on > v_today
                        when 'today' then r.status = 'booked' and r.check_in_on <= v_today and r.check_out_on > v_today
                        else r.status <> 'booked' and r.created_at > now() - interval '60 days' end
     limit 300) x), '[]'::jsonb);
end $$;
revoke all on function public.padh_reservations_list(text) from public, anon, service_role;
grant execute on function public.padh_reservations_list(text) to authenticated;

-- ---------- the room chart ----------
-- every room with its status, and bars (a guest in the house, a booking) between p_from and p_from + p_days; plus the day's numbers
create or replace function public.padh_room_chart(p_from date, p_days int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_today date := private.hotel_today(v_rid); v_from date := coalesce(p_from, private.hotel_today(v_rid)); v_to date;
begin
  if coalesce(p_days, 14) not between 1 and 31 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  v_to := v_from + coalesce(p_days, 14);
  return jsonb_build_object(
    'today', v_today, 'from', v_from, 'days', coalesce(p_days, 14),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', rm.id, 'number', rm.number, 'floor', rm.floor, 'type_id', rm.room_type_id, 'type', rt.name, 'rate_paise', rt.rate_paise,
        'hk_status', rm.hk_status, 'hk_note', rm.hk_note, 'occupied', exists (select 1 from public.stays s where s.room_id = rm.id and s.status = 'in_house')) order by rm.number)
      from public.rooms rm left join public.room_types rt on rt.id = rm.room_type_id where rm.restaurant_id = v_rid and rm.active), '[]'::jsonb),
    'bars', coalesce((select jsonb_agg(b) from (
      select jsonb_build_object('kind', 'stay', 'id', s.id, 'room_id', s.room_id, 'guest', s.guest_name, 'from', (s.check_in_at at time zone coalesce(h.timezone, 'Asia/Kolkata'))::date, 'to', s.check_out_on) as b
        from public.stays s cross join (select timezone from public.hotel_settings where restaurant_id = v_rid) h
       where s.restaurant_id = v_rid and s.status = 'in_house' and s.check_out_on > v_from
      union all
      select jsonb_build_object('kind', 'booking', 'id', r.id, 'room_id', r.room_id, 'type_id', r.room_type_id, 'guest', r.guest_name, 'from', r.check_in_on, 'to', r.check_out_on, 'seq', r.seq)
        from public.reservations r where r.restaurant_id = v_rid and r.status = 'booked' and r.check_in_on < v_to and r.check_out_on > v_from) q), '[]'::jsonb),
    'summary', jsonb_build_object(
      'rooms', (select count(*) from public.rooms where restaurant_id = v_rid and active),
      'in_house', (select count(*) from public.stays where restaurant_id = v_rid and status = 'in_house'),
      'arrivals', (select count(*) from public.reservations where restaurant_id = v_rid and status = 'booked' and check_in_on <= v_today and check_out_on > v_today),
      'departures', (select count(*) from public.stays where restaurant_id = v_rid and status = 'in_house' and check_out_on <= v_today),
      'dirty', (select count(*) from public.rooms where restaurant_id = v_rid and active and hk_status = 'dirty'),
      'out_of_order', (select count(*) from public.rooms where restaurant_id = v_rid and active and hk_status = 'out_of_order'))
  );
end $$;
revoke all on function public.padh_room_chart(date, int) from public, anon, service_role;
grant execute on function public.padh_room_chart(date, int) to authenticated;

-- ---------- housekeeping ----------
-- reception and managers (and the housekeeping staff on the desk) mark a room clean, dirty, being cleaned, or out of order
create or replace function public.padh_room_hk_set(p_room uuid, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); v_note text := private.bill_text(p_note); v_id uuid;
begin
  if p_status is null or p_status not in ('clean','dirty','cleaning','out_of_order') or (v_note is not null and char_length(v_note) > 120) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if p_status = 'out_of_order' and exists (select 1 from public.stays where room_id = p_room and status = 'in_house') then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  update public.rooms set hk_status = p_status, hk_note = case when p_status in ('dirty','out_of_order') then v_note end, hk_updated_at = now() where id = p_room and restaurant_id = v_rid and active returning id into v_id;
  if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  perform private.write_audit(v_rid, 'padh_room_hk_set', 'rooms', v_id::text, jsonb_build_object('status', p_status));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_room_hk_set(uuid, text, text) from public, anon, service_role;
grant execute on function public.padh_room_hk_set(uuid, text, text) to authenticated;

-- ---------- search ----------
-- one box in the top bar: a guest's name, a room number, a mobile number, a booking number or an invoice number
create or replace function public.padh_search(p_q text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_q text := btrim(coalesce(p_q, '')); v_like text; v_digits text;
begin
  if char_length(v_q) < 2 or char_length(v_q) > 40 then return '[]'::jsonb; end if;
  if not private.rl_hit('padh_search:' || v_rid::text || ':' || auth.uid()::text, 120, 60) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  v_like := '%' || replace(replace(replace(lower(v_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  v_digits := nullif(regexp_replace(v_q, '[^0-9]', '', 'g'), '');
  return coalesce((select jsonb_agg(x) from (
    (select jsonb_build_object('kind', 'stay', 'id', s.id, 'title', s.guest_name, 'sub', 'Room ' || rm.number || ' · ' || case when s.status = 'in_house' then 'in the hotel' else 'checked out' end, 'room', rm.number) as x
       from public.stays s join public.rooms rm on rm.id = s.room_id
      where s.restaurant_id = v_rid and (lower(s.guest_name) like v_like escape '\' or lower(rm.number) = lower(v_q) or (v_digits is not null and char_length(v_digits) >= 4 and s.mobile like '%' || v_digits || '%'))
      order by (s.status = 'in_house') desc, s.check_in_at desc limit 6)
    union all
    (select jsonb_build_object('kind', 'booking', 'id', r.id, 'title', r.guest_name, 'sub', 'Booking B' || r.seq || ' · ' || to_char(r.check_in_on, 'DD Mon') || ' to ' || to_char(r.check_out_on, 'DD Mon') || ' · ' || r.status, 'seq', r.seq)
       from public.reservations r
      where r.restaurant_id = v_rid and (lower(r.guest_name) like v_like escape '\' or ('b' || r.seq) = lower(v_q) or (v_digits is not null and char_length(v_digits) >= 4 and r.mobile like '%' || v_digits || '%'))
      order by r.created_at desc limit 5)
    union all
    (select jsonb_build_object('kind', 'invoice', 'id', i.stay_id, 'title', i.number, 'sub', (select guest_name from public.stays where id = i.stay_id))
       from public.invoices i where i.restaurant_id = v_rid and lower(i.number) like v_like escape '\' order by i.issued_at desc limit 3)
  ) q), '[]'::jsonb);
end $$;
revoke all on function public.padh_search(text) from public, anon, service_role;
grant execute on function public.padh_search(text) to authenticated;

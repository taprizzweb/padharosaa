-- 0076_fixes_pos_charges
-- 1. The "in the hotel" list read the check-out day and the number of nights from the wrong place in the bill, so both came back empty and the
--    Billing screen crashed as soon as a guest was checked in. They are now read from the bill's stay.
-- 2. Counter billing: the desk can pick the tax for this bill (any of the hotel's own rates, or none), add a service charge (percent) and give a
--    discount in rupees. The tax is worked out on the amount after the discount, with the service charge. The old padh_pos_create stays
--    in the database but can no longer be called by staff.
-- 3. The menu for the counter also sends the hotel's tax rates; the owner's report counts the counter's sales after discount and with service charge.
-- Idempotent. Rollback: restore padh_stays_list, padh_pos_menu, padh_pos_get and padh_report from 0067 and 0073, grant execute on the old padh_pos_create, drop the new function and columns.
alter table public.pos_bills add column if not exists discount_paise bigint not null default 0 check (discount_paise >= 0);
alter table public.pos_bills add column if not exists service_bp int not null default 0 check (service_bp between 0 and 3000);
alter table public.pos_bills add column if not exists service_paise bigint not null default 0 check (service_paise >= 0);

create or replace function public.padh_stays_list(p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff();
begin
  if p_status not in ('in_house','checked_out') then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  return coalesce((select jsonb_agg(x order by x.room) from (
    select s.id, rm.number as room, s.guest_name, s.company_name, s.check_in_at, s.checked_out_at, s.status, s.rate_paise,
           f.f->'stay'->>'nights' as nights, (f.f->'stay'->>'check_out_on') as check_out_on, (f.f->>'total_paise')::bigint as total_paise, (f.f->>'paid_paise')::bigint as paid_paise, (f.f->>'balance_paise')::bigint as balance_paise,
           i.number as invoice_number
      from public.stays s join public.rooms rm on rm.id = s.room_id
      left join public.invoices i on i.stay_id = s.id
      cross join lateral (select private.folio_calc(s.id) as f) f
     where s.restaurant_id = v_rid and s.status = p_status
       and (p_status = 'in_house' or s.checked_out_at > now() - interval '30 days')
     limit 200) x), '[]'::jsonb);
end $$;
revoke all on function public.padh_stays_list(text) from public, anon, service_role;
grant execute on function public.padh_stays_list(text) to authenticated;

create or replace function public.padh_pos_menu() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff();
begin
  return jsonb_build_object(
    'tax_bp', coalesce((select tr.rate_bp from public.charge_categories c join public.tax_rates tr on tr.id = c.tax_rate_id where c.restaurant_id = v_rid and c.kind = 'food'), 0),
    'tax_rates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'rate_bp', t.rate_bp) order by t.rate_bp, t.name) from public.tax_rates t where t.restaurant_id = v_rid and t.active), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name_en, 'items', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name_en, 'price_paise', i.price_paise, 'diet', i.diet, 'available', i.is_available) order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = v_rid), '[]'::jsonb)) order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = v_rid and c.active), '[]'::jsonb));
end $$;
revoke all on function public.padh_pos_menu() from public, anon, service_role;
grant execute on function public.padh_pos_menu() to authenticated;

-- p_tax_bp: the tax for this bill in basis points (0 = no tax); null = the hotel's rate for food. It must be 0 or one of the hotel's own active rates.
-- p_service_bp: service charge, percent in basis points (0 to 30%). p_discount_paise: rupees off the items, before service charge and tax.
create or replace function public.padh_pos_bill(p_lines text, p_label text, p_customer text, p_mode text, p_stay uuid, p_tax_bp int, p_service_bp int, p_discount_paise int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.billing_staff(); v_label text := private.bill_text(p_label); v_cust text := private.bill_text(p_customer); v_in jsonb; v_out jsonb; v_sub bigint; v_bp int;
  v_disc bigint := coalesce(p_discount_paise, 0); v_sbp int := coalesce(p_service_bp, 0); v_service bigint; v_taxable bigint;
  v_tax bigint; v_grand bigint; v_total bigint; v_round bigint; v_today date; v_fy text; v_no int; v_number text; v_id uuid; v_line uuid; h public.hotel_settings; v_food uuid;
begin
  begin v_in := p_lines::jsonb; exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  if jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) not between 1 and 60 or p_mode is null or p_mode not in ('cash','card','upi','bank','room')
     or (v_label is not null and char_length(v_label) > 40) or (v_cust is not null and char_length(v_cust) > 80) or (p_mode = 'room') <> (p_stay is not null)
     or v_sbp not between 0 and 3000 or v_disc < 0 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_stay is not null and not exists (select 1 from public.stays where id = p_stay and restaurant_id = v_rid and status = 'in_house') then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if not private.rl_hit('padh_pos:' || v_rid::text, 1500, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  begin
    select jsonb_agg(jsonb_build_object('name', x.name, 'qty', x.qty, 'unit_paise', x.unit, 'amount_paise', x.qty::bigint * x.unit)) into v_out from (
      select coalesce(i.name_en, private.bill_text(e->>'name')) as name, (e->>'qty')::int as qty, coalesce(i.price_paise, (e->>'unit_paise')::int) as unit
        from jsonb_array_elements(v_in) e left join public.items i on i.id = nullif(e->>'item', '')::uuid and i.restaurant_id = v_rid) x;
  exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  if exists (select 1 from jsonb_array_elements(v_out) l where (l->>'name') is null or char_length(l->>'name') > 80 or (l->>'qty')::int not between 1 and 99 or (l->>'unit_paise')::int not between 1 and 10000000) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select sum((l->>'amount_paise')::bigint) into v_sub from jsonb_array_elements(v_out) l;
  if v_disc >= v_sub then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  perform private.billing_defaults(v_rid);
  select tr.rate_bp, c.id into v_bp, v_food from public.charge_categories c left join public.tax_rates tr on tr.id = c.tax_rate_id where c.restaurant_id = v_rid and c.kind = 'food';
  if p_tax_bp is not null then
    if p_tax_bp <> 0 and not exists (select 1 from public.tax_rates where restaurant_id = v_rid and active and rate_bp = p_tax_bp) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
    v_bp := p_tax_bp;
  end if;
  v_bp := coalesce(v_bp, 0);
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  v_service := ((v_sub - v_disc) * v_sbp + 5000) / 10000;
  v_taxable := v_sub - v_disc + v_service;
  v_tax := case when v_bp = 0 then 0 else 2 * private.gst_half(v_taxable, v_bp) end;
  v_grand := v_taxable + v_tax;
  v_total := case when h.round_off then ((v_grand + 50) / 100) * 100 else v_grand end;
  v_round := v_total - v_grand;
  v_today := private.hotel_today(v_rid);
  v_fy := private.fy_of(v_today);
  insert into public.pos_counters (restaurant_id, fy, last_no) values (v_rid, v_fy, 1) on conflict (restaurant_id, fy) do update set last_no = public.pos_counters.last_no + 1 returning last_no into v_no;
  v_number := 'POS/' || v_fy || '/' || lpad(v_no::text, 4, '0');
  if p_stay is not null then
    -- on a room bill the room's own folio adds the tax, so the amount before tax (after discount, with service charge) goes there
    insert into public.folio_lines (restaurant_id, stay_id, category_id, description, qty, unit_paise, created_by) values (v_rid, p_stay, v_food, 'Restaurant bill ' || v_number, 1, least(v_taxable, 10000000)::int, auth.uid()) returning id into v_line;
  end if;
  insert into public.pos_bills (restaurant_id, number, label, customer, lines, subtotal_paise, discount_paise, service_bp, service_paise, tax_bp, tax_paise, round_paise, total_paise, pay_mode, stay_id, folio_line_id, created_by)
  values (v_rid, v_number, v_label, v_cust, v_out, v_sub, v_disc, v_sbp, v_service, v_bp, v_tax, v_round, v_total, p_mode, p_stay, v_line, auth.uid()) returning id into v_id;
  perform private.write_audit(v_rid, 'padh_pos_create', 'pos_bills', v_id::text, jsonb_build_object('number', v_number, 'total_paise', v_total, 'mode', p_mode));
  return jsonb_build_object('id', v_id, 'number', v_number, 'total_paise', v_total);
end $$;
revoke all on function public.padh_pos_bill(text, text, text, text, uuid, int, int, int) from public, anon, service_role;
grant execute on function public.padh_pos_bill(text, text, text, text, uuid, int, int, int) to authenticated;
revoke all on function public.padh_pos_create(text, text, text, text, uuid) from public, anon, authenticated, service_role;

create or replace function public.padh_pos_get(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); b public.pos_bills; h public.hotel_settings; r public.restaurants; s record;
begin
  select * into b from public.pos_bills where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  select * into r from public.restaurants where id = v_rid;
  select rm.number as room, st.guest_name as guest into s from public.stays st join public.rooms rm on rm.id = st.room_id where st.id = b.stay_id;
  return jsonb_build_object('number', b.number, 'at', b.created_at, 'label', b.label, 'customer', b.customer, 'lines', b.lines, 'subtotal_paise', b.subtotal_paise,
    'discount_paise', b.discount_paise, 'service_bp', b.service_bp, 'service_paise', b.service_paise, 'tax_bp', b.tax_bp, 'tax_paise', b.tax_paise,
    'round_paise', b.round_paise, 'total_paise', b.total_paise, 'pay_mode', b.pay_mode, 'status', b.status, 'void_reason', b.void_reason, 'room', s.room, 'guest', s.guest,
    'hotel', jsonb_build_object('name', r.name, 'legal_name', h.legal_name, 'gstin', h.gstin, 'address', h.bill_address));
end $$;
revoke all on function public.padh_pos_get(uuid) from public, anon, service_role;
grant execute on function public.padh_pos_get(uuid) to authenticated;

create or replace function public.padh_report(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_tz text; v_rooms int; v_out jsonb;
begin
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from public.hotel_settings where restaurant_id = v_rid;
  select count(*) into v_rooms from public.rooms where restaurant_id = v_rid and active;
  with days as (select d::date as d from generate_series(p_from, p_to, interval '1 day') d),
  inv as (
    select (i.issued_at at time zone v_tz)::date as d,
           coalesce(sum((l->>'amount_paise')::bigint) filter (where l->>'src' = 'room'), 0) as room,
           coalesce(sum((l->>'amount_paise')::bigint) filter (where l->>'src' = 'order'), 0) as food,
           coalesce(sum((l->>'amount_paise')::bigint) filter (where l->>'src' in ('manual','extra')), 0) as other,
           count(distinct i.id) as n, max((i.snapshot->'folio'->>'tax_paise')::bigint) as t
      from public.invoices i, jsonb_array_elements(i.snapshot->'folio'->'lines') l
     where i.restaurant_id = v_rid and (i.issued_at at time zone v_tz)::date between p_from and p_to group by i.id, 1),
  invd as (select d, sum(room) as room, sum(food) as food, sum(other) as other, sum(n) as invoices, sum(t) as tax from inv group by d),
  pos as (select (created_at at time zone v_tz)::date as d, sum(subtotal_paise - discount_paise + service_paise) as sales, sum(tax_paise) as tax, count(*) as bills
            from public.pos_bills where restaurant_id = v_rid and status = 'paid' and pay_mode <> 'room' and (created_at at time zone v_tz)::date between p_from and p_to group by 1),
  occ as (select dd.d, count(s.id) as rooms_sold from days dd left join public.stays s on s.restaurant_id = v_rid and s.status in ('in_house','checked_out')
            and (s.check_in_at at time zone v_tz)::date <= dd.d and dd.d < case when s.status = 'checked_out' then s.check_out_on else greatest(s.check_out_on, private.hotel_today(v_rid)) end group by dd.d),
  pay as (select (created_at at time zone v_tz)::date as d, mode, sum(case when kind = 'refund' then -amount_paise else amount_paise end) as amt from public.stay_payments
           where restaurant_id = v_rid and (created_at at time zone v_tz)::date between p_from and p_to group by 1, 2
          union all
          select (created_at at time zone v_tz)::date, pay_mode, sum(total_paise) from public.pos_bills where restaurant_id = v_rid and status = 'paid' and pay_mode <> 'room' and (created_at at time zone v_tz)::date between p_from and p_to group by 1, 2)
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'rooms', v_rooms,
    'days', (select jsonb_agg(jsonb_build_object('day', dd.d, 'room', coalesce(i.room, 0), 'food', coalesce(i.food, 0) + coalesce(p.sales, 0), 'other', coalesce(i.other, 0), 'tax', coalesce(i.tax, 0) + coalesce(p.tax, 0),
              'invoices', coalesce(i.invoices, 0), 'pos_bills', coalesce(p.bills, 0), 'rooms_sold', o.rooms_sold,
              'collected', (select coalesce(sum(amt), 0) from pay where pay.d = dd.d)) order by dd.d)
              from days dd left join invd i on i.d = dd.d left join pos p on p.d = dd.d left join occ o on o.d = dd.d),
    'by_mode', coalesce((select jsonb_object_agg(mode, amt) from (select mode, sum(amt) as amt from pay group by mode) m), '{}'::jsonb))
  into v_out;
  return v_out;
end $$;
revoke all on function public.padh_report(date, date) from public, anon, service_role;
grant execute on function public.padh_report(date, date) to authenticated;

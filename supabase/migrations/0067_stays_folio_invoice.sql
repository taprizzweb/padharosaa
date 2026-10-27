-- 0067_stays_folio_invoice
-- Front office billing, step 2: check a guest in, keep the bill (folio), take payments, and check out with a GST invoice.
--  * private.folio_calc builds the bill of one stay: room rent for the nights, food ordered to the room (orders marked "room bill"), charges
--    added at the desk, and the hotel's extra charges. Tax comes from the hotel's own setup (0066). It is the ONLY place money is added up.
--  * Tax is worked out per rate on the total taxable value (CGST + SGST halves, or IGST for another state), in whole paise, rounded half up;
--    the total is rounded to the rupee unless the hotel switched that off.
--  * An invoice is a frozen copy of the folio with the next number of the financial year (April to March). It exists only after check-out,
--    which needs the balance to be exactly zero.
-- Idempotent. Rollback: restore padh_checkout_room from 0058 and drop the functions.
create or replace function private.folio_calc(p_stay uuid, p_checkout boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.stays; h public.hotel_settings; rm public.rooms; rt public.room_types; v_room_cat public.charge_categories; v_food_cat public.charge_categories;
  v_tz text; v_today date; v_in date; v_ref date; v_nights int; v_room_tid uuid;
  v_lines jsonb; v_groups jsonb; v_sub bigint; v_tax bigint; v_grand bigint; v_total bigint; v_round bigint; v_paid bigint; v_pays jsonb;
begin
  select * into s from public.stays where id = p_stay;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into h from public.hotel_settings where restaurant_id = s.restaurant_id;
  select * into rm from public.rooms where id = s.room_id;
  select * into rt from public.room_types where id = rm.room_type_id;
  select * into v_room_cat from public.charge_categories where restaurant_id = s.restaurant_id and kind = 'room';
  select * into v_food_cat from public.charge_categories where restaurant_id = s.restaurant_id and kind = 'food';
  v_tz := coalesce(h.timezone, 'Asia/Kolkata');
  v_today := (now() at time zone v_tz)::date;
  v_in := (s.check_in_at at time zone v_tz)::date;
  v_ref := case when s.status = 'checked_out' then s.check_out_on when p_checkout then v_today else greatest(s.check_out_on, v_today) end;
  v_nights := greatest(1, v_ref - v_in);
  -- the room's tax: the slab for the nightly rate if the hotel has set slabs, else the room category's own tax
  v_room_tid := coalesce(
    (select sl.tax_rate_id from public.room_tax_slabs sl where sl.restaurant_id = s.restaurant_id and sl.active and (sl.up_to_paise is null or s.rate_paise <= sl.up_to_paise) order by sl.up_to_paise nulls last limit 1),
    v_room_cat.tax_rate_id);

  with base as (
    select 10 as ord, 'room'::text as src, ('Room rent · ' || coalesce(rt.name || ' · ', '') || 'Room ' || rm.number) as description, v_nights as qty, s.rate_paise as unit_paise,
           (v_nights::bigint * s.rate_paise) as amount, v_room_tid as tid, v_room_cat.sac as sac, s.check_in_at as at
    union all
    select 20, 'order', 'Room service · order #' || o.order_no, 1, o.total_paise, o.total_paise::bigint, v_food_cat.tax_rate_id, v_food_cat.sac, o.created_at
      from public.dining_tables t
      join public.table_sessions ts on ts.table_id = t.id and ts.restaurant_id = t.restaurant_id
      join public.orders o on o.session_id = ts.id and o.restaurant_id = ts.restaurant_id
     where t.restaurant_id = s.restaurant_id and t.kind = 'room' and t.label = 'Room ' || upper(rm.number)
       and o.status <> 'cancelled' and o.pay_method = 'room_bill' and o.created_at >= s.check_in_at
       and (s.checked_out_at is null or o.created_at <= s.checked_out_at)
    union all
    select 30, 'manual', f.description, f.qty, f.unit_paise, (f.qty::bigint * f.unit_paise), c.tax_rate_id, c.sac, f.posted_at
      from public.folio_lines f join public.charge_categories c on c.id = f.category_id
     where f.stay_id = s.id and f.voided_at is null
  ), ex as (
    select 40 as ord, 'extra'::text as src, e.name as description,
           (case when e.mode = 'per_night' then v_nights else 1 end) as qty,
           (case when e.mode = 'per_night' then e.value else null end) as unit_paise,
           (case e.mode
              when 'percent' then ((greatest((select coalesce(sum(b.amount), 0) from base b
                                               where e.applies_to = 'all' or (e.applies_to = 'room' and b.src = 'room') or (e.applies_to = 'food' and b.src = 'order'))::bigint, 0) * e.value) + 5000) / 10000
              when 'per_night' then v_nights::bigint * e.value
              else e.value::bigint end) as amount,
           e.tax_rate_id as tid, null::text as sac, s.check_in_at as at
      from public.bill_extras e where e.restaurant_id = s.restaurant_id and e.active
  ), allines as (
    select * from base union all select * from ex where amount <> 0
  ), withtax as (
    select a.*, coalesce(tr.rate_bp, 0) as bp from allines a left join public.tax_rates tr on tr.id = a.tid
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('src', w.src, 'description', w.description, 'qty', w.qty, 'unit_paise', w.unit_paise, 'amount_paise', w.amount, 'tax_bp', w.bp, 'sac', w.sac, 'at', w.at) order by w.ord, w.at), '[]'::jsonb) from withtax w),
    (select coalesce(jsonb_agg(jsonb_build_object('tax_bp', g.bp, 'taxable_paise', g.taxable,
        'cgst_paise', case when s.inter_state then 0 else private.gst_half(g.taxable, g.bp) end,
        'sgst_paise', case when s.inter_state then 0 else private.gst_half(g.taxable, g.bp) end,
        'igst_paise', case when s.inter_state then private.gst_full(g.taxable, g.bp) else 0 end,
        'tax_paise', case when s.inter_state then private.gst_full(g.taxable, g.bp) else 2 * private.gst_half(g.taxable, g.bp) end) order by g.bp), '[]'::jsonb)
       from (select bp, sum(amount)::bigint as taxable from withtax group by bp) g),
    (select coalesce(sum(amount), 0)::bigint from withtax)
  into v_lines, v_groups, v_sub;

  v_tax := coalesce((select sum((g->>'tax_paise')::bigint) from jsonb_array_elements(v_groups) g), 0);
  v_grand := v_sub + v_tax;
  v_total := case when h.round_off and v_grand > 0 then ((v_grand + 50) / 100) * 100 else v_grand end;
  v_round := v_total - v_grand;
  select coalesce(sum(case when kind = 'refund' then -amount_paise else amount_paise end), 0)::bigint,
         coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'mode', mode, 'amount_paise', amount_paise, 'ref', ref, 'at', created_at) order by created_at), '[]'::jsonb)
    into v_paid, v_pays from public.stay_payments where stay_id = s.id;

  return jsonb_build_object(
    'stay', jsonb_build_object('id', s.id, 'status', s.status, 'guest_name', s.guest_name, 'mobile', s.mobile, 'adults', s.adults, 'company_name', s.company_name, 'company_gstin', s.company_gstin,
      'address', s.address, 'inter_state', s.inter_state, 'room', rm.number, 'room_type', rt.name, 'check_in_at', s.check_in_at, 'check_out_on', v_ref, 'checked_out_at', s.checked_out_at,
      'nights', v_nights, 'rate_paise', s.rate_paise),
    'lines', v_lines, 'tax_groups', v_groups, 'subtotal_paise', v_sub, 'tax_paise', v_tax, 'round_off_paise', v_round, 'total_paise', v_total,
    'payments', v_pays, 'paid_paise', v_paid, 'balance_paise', v_total - v_paid);
end $$;
revoke all on function private.folio_calc(uuid, boolean) from public, anon;

-- the desk may only touch stays of its own hotel; reception, manager and owner
create or replace function private.billing_staff() returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']);
begin
  if not private.sees_everything() then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  return v_rid;
end $$;
revoke all on function private.billing_staff() from public, anon;
grant execute on function private.billing_staff() to authenticated;

-- ---------- check-in ----------
create or replace function public.padh_stay_checkin(
  p_room uuid, p_guest text, p_mobile text, p_id_type text, p_id_last4 text, p_adults int, p_company text, p_gstin text, p_inter_state boolean,
  p_address text, p_rate_paise int, p_out_on date, p_advance_paise int, p_advance_mode text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.billing_staff(); h public.hotel_settings; rm public.rooms; rt public.room_types;
  v_name text := private.bill_text(p_guest); v_mobile text := nullif(regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g'), '');
  v_company text := private.bill_text(p_company); v_gst text := upper(nullif(btrim(coalesce(p_gstin, '')), '')); v_addr text := private.bill_text(p_address);
  v_last4 text := nullif(btrim(coalesce(p_id_last4, '')), ''); v_rate int; v_today date; v_inter boolean; v_id uuid; v_code jsonb; v_adv int := coalesce(p_advance_paise, 0);
begin
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  v_today := (now() at time zone coalesce(h.timezone, 'Asia/Kolkata'))::date;
  select * into rm from public.rooms where id = p_room and restaurant_id = v_rid and active;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into rt from public.room_types where id = rm.room_type_id;
  v_rate := coalesce(p_rate_paise, rt.rate_paise);
  if v_name is null or char_length(v_name) not between 2 and 80 or (v_mobile is not null and v_mobile !~ '^[0-9]{10,15}$')
     or (p_id_type is not null and p_id_type not in ('aadhaar','passport','driving_licence','voter_id','other')) or (v_last4 is not null and v_last4 !~ '^[A-Za-z0-9]{1,4}$')
     or coalesce(p_adults, 1) not between 1 and 20 or (v_company is not null and char_length(v_company) > 120)
     or (v_gst is not null and v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') or (v_addr is not null and char_length(v_addr) > 300)
     or v_rate is null or v_rate not between 0 and 10000000 or p_out_on is null or p_out_on <= v_today or p_out_on > v_today + 90
     or v_adv not between 0 and 100000000 or (v_adv > 0 and coalesce(p_advance_mode, '') not in ('cash','card','upi','bank','company')) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not private.rl_hit('padh_checkin:' || v_rid::text, 200, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  if exists (select 1 from public.stays where room_id = p_room and status = 'in_house') then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  -- another state when the guest's company is registered in a different state than the hotel (the first two digits of a GSTIN); the desk can force it
  v_inter := coalesce(p_inter_state, v_gst is not null and h.gstin is not null and left(v_gst, 2) <> left(h.gstin, 2));
  perform private.billing_defaults(v_rid);
  insert into public.stays (restaurant_id, room_id, guest_name, mobile, id_type, id_last4, adults, company_name, company_gstin, address, inter_state, rate_paise, check_out_on, created_by)
  values (v_rid, p_room, v_name, v_mobile, p_id_type, v_last4, coalesce(p_adults, 1), v_company, v_gst, v_addr, v_inter, v_rate, p_out_on, auth.uid()) returning id into v_id;
  if v_adv > 0 then
    insert into public.stay_payments (restaurant_id, stay_id, kind, mode, amount_paise, created_by) values (v_rid, v_id, 'advance', p_advance_mode, v_adv, auth.uid());
  end if;
  v_code := public.padh_issue_stay_code(p_room);
  perform private.write_audit(v_rid, 'padh_stay_checkin', 'stays', v_id::text, jsonb_build_object('room', rm.number, 'rate_paise', v_rate, 'advance_paise', v_adv));
  return jsonb_build_object('stay_id', v_id, 'room', rm.number, 'stay_code', v_code->>'code');
end $$;
revoke all on function public.padh_stay_checkin(uuid, text, text, text, text, int, text, text, boolean, text, int, date, int, text) from public, anon, service_role;
grant execute on function public.padh_stay_checkin(uuid, text, text, text, text, int, text, text, boolean, text, int, date, int, text) to authenticated;

-- ---------- lists and the folio ----------
-- p_status 'in_house' (everyone in the hotel now, with the balance) or 'checked_out' (the last 30, with the invoice number)
create or replace function public.padh_stays_list(p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff();
begin
  if p_status not in ('in_house','checked_out') then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  return coalesce((select jsonb_agg(x order by x.room) from (
    select s.id, rm.number as room, s.guest_name, s.company_name, s.check_in_at, s.checked_out_at, s.status, s.rate_paise,
           f.f->>'nights' as nights, (f.f->>'check_out_on') as check_out_on, (f.f->>'total_paise')::bigint as total_paise, (f.f->>'paid_paise')::bigint as paid_paise, (f.f->>'balance_paise')::bigint as balance_paise,
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

-- p_checkout true = "what it will come to if the guest leaves now" (the nights are counted up to today)
create or replace function public.padh_folio(p_stay uuid, p_checkout boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); s public.stays; i public.invoices; v_f jsonb; v_paid bigint; v_pays jsonb;
begin
  select * into s from public.stays where id = p_stay and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into i from public.invoices where stay_id = s.id;
  if found then
    v_f := i.snapshot->'folio';
    select coalesce(sum(case when kind = 'refund' then -amount_paise else amount_paise end), 0)::bigint,
           coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'mode', mode, 'amount_paise', amount_paise, 'ref', ref, 'at', created_at) order by created_at), '[]'::jsonb)
      into v_paid, v_pays from public.stay_payments where stay_id = s.id;
    v_f := v_f || jsonb_build_object('payments', v_pays, 'paid_paise', v_paid, 'balance_paise', (v_f->>'total_paise')::bigint - v_paid);
    return jsonb_build_object('folio', v_f, 'invoice', jsonb_build_object('number', i.number, 'issued_at', i.issued_at));
  end if;
  return jsonb_build_object('folio', private.folio_calc(s.id, coalesce(p_checkout, false) and s.status = 'in_house'), 'invoice', null,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'description', f.description, 'qty', f.qty, 'unit_paise', f.unit_paise, 'posted_at', f.posted_at) order by f.posted_at)
                         from public.folio_lines f where f.stay_id = s.id and f.voided_at is null), '[]'::jsonb));
end $$;
revoke all on function public.padh_folio(uuid, boolean) from public, anon, service_role;
grant execute on function public.padh_folio(uuid, boolean) to authenticated;

-- ---------- charges, payments, edits ----------
create or replace function public.padh_folio_add(p_stay uuid, p_category uuid, p_description text, p_qty int, p_unit_paise int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_desc text := private.bill_text(p_description); v_id uuid;
begin
  if v_desc is null or char_length(v_desc) > 120 or p_qty is null or p_qty not between 1 and 99 or p_unit_paise is null or p_unit_paise = 0 or p_unit_paise not between -10000000 and 10000000 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.stays where id = p_stay and restaurant_id = v_rid and status = 'in_house') then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if not exists (select 1 from public.charge_categories where id = p_category and restaurant_id = v_rid and active) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if not private.rl_hit('padh_bill:' || v_rid::text, 1200, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  insert into public.folio_lines (restaurant_id, stay_id, category_id, description, qty, unit_paise, created_by) values (v_rid, p_stay, p_category, v_desc, p_qty, p_unit_paise, auth.uid()) returning id into v_id;
  perform private.write_audit(v_rid, 'padh_folio_add', 'folio_lines', v_id::text, jsonb_build_object('stay', p_stay, 'qty', p_qty, 'unit_paise', p_unit_paise));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_folio_add(uuid, uuid, text, int, int) from public, anon, service_role;
grant execute on function public.padh_folio_add(uuid, uuid, text, int, int) to authenticated;

-- a wrong charge is crossed out with a reason (it stays on record, it just no longer counts)
create or replace function public.padh_folio_void(p_line uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_reason text := private.bill_text(p_reason); v_id uuid;
begin
  if v_reason is null or char_length(v_reason) > 200 then raise exception using errcode = 'GM014', message = 'reason_required'; end if;
  update public.folio_lines f set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where f.id = p_line and f.restaurant_id = v_rid and f.voided_at is null
     and exists (select 1 from public.stays s where s.id = f.stay_id and s.status = 'in_house')
  returning f.id into v_id;
  if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  perform private.write_audit(v_rid, 'padh_folio_void', 'folio_lines', v_id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_folio_void(uuid, text) from public, anon, service_role;
grant execute on function public.padh_folio_void(uuid, text) to authenticated;

create or replace function public.padh_payment_add(p_stay uuid, p_kind text, p_mode text, p_amount_paise int, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_ref text := private.bill_text(p_ref); v_id uuid; v_paid bigint;
begin
  if p_kind not in ('advance','payment','refund') or p_mode not in ('cash','card','upi','bank','company') or p_amount_paise is null or p_amount_paise not between 1 and 100000000
     or (v_ref is not null and char_length(v_ref) > 60) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  perform 1 from public.stays where id = p_stay and restaurant_id = v_rid and status = 'in_house' for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if not private.rl_hit('padh_pay:' || v_rid::text, 1200, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  select coalesce(sum(case when kind = 'refund' then -amount_paise else amount_paise end), 0) into v_paid from public.stay_payments where stay_id = p_stay;
  if p_kind = 'refund' and p_amount_paise > v_paid then raise exception using errcode = 'GM015', message = 'invalid_input'; end if; -- cannot refund more than was paid
  insert into public.stay_payments (restaurant_id, stay_id, kind, mode, amount_paise, ref, created_by) values (v_rid, p_stay, p_kind, p_mode, p_amount_paise, v_ref, auth.uid()) returning id into v_id;
  perform private.write_audit(v_rid, 'padh_payment_add', 'stay_payments', v_id::text, jsonb_build_object('stay', p_stay, 'kind', p_kind, 'mode', p_mode, 'amount_paise', p_amount_paise));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_payment_add(uuid, text, text, int, text) from public, anon, service_role;
grant execute on function public.padh_payment_add(uuid, text, text, int, text) to authenticated;

-- change the nightly rate, the planned last night, or the company details of a guest still in the hotel (null = leave as it is)
create or replace function public.padh_stay_update(p_stay uuid, p_rate_paise int, p_out_on date, p_company text, p_gstin text, p_inter_state boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); s public.stays; h public.hotel_settings; v_today date; v_company text := private.bill_text(p_company); v_gst text := upper(nullif(btrim(coalesce(p_gstin, '')), ''));
  v_inter boolean;
begin
  select * into s from public.stays where id = p_stay and restaurant_id = v_rid and status = 'in_house' for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  v_today := (now() at time zone coalesce(h.timezone, 'Asia/Kolkata'))::date;
  if (p_rate_paise is not null and p_rate_paise not between 0 and 10000000) or (p_out_on is not null and (p_out_on <= (s.check_in_at at time zone coalesce(h.timezone, 'Asia/Kolkata'))::date or p_out_on > v_today + 90))
     or (v_company is not null and char_length(v_company) > 120) or (v_gst is not null and v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$') then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  v_inter := coalesce(p_inter_state, case when v_gst is not null and h.gstin is not null then left(v_gst, 2) <> left(h.gstin, 2) else s.inter_state end);
  update public.stays set rate_paise = coalesce(p_rate_paise, rate_paise), check_out_on = coalesce(p_out_on, check_out_on),
         company_name = coalesce(v_company, company_name), company_gstin = coalesce(v_gst, company_gstin), inter_state = v_inter where id = s.id;
  perform private.write_audit(v_rid, 'padh_stay_update', 'stays', s.id::text, jsonb_build_object('rate_paise', p_rate_paise, 'out_on', p_out_on));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_stay_update(uuid, int, date, text, text, boolean) from public, anon, service_role;
grant execute on function public.padh_stay_update(uuid, int, date, text, text, boolean) to authenticated;

-- ---------- check-out and the invoice ----------
create or replace function private.invoice_issue(p_stay uuid, p_rid uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare h public.hotel_settings; r public.restaurants; v_folio jsonb; v_local timestamp; v_start int; v_fy text; v_no int; v_number text;
begin
  select * into h from public.hotel_settings where restaurant_id = p_rid;
  select * into r from public.restaurants where id = p_rid;
  v_folio := private.folio_calc(p_stay);
  v_local := now() at time zone coalesce(h.timezone, 'Asia/Kolkata');
  v_start := case when extract(month from v_local) >= 4 then extract(year from v_local)::int else extract(year from v_local)::int - 1 end;
  v_fy := v_start::text || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');
  insert into public.invoice_counters (restaurant_id, fy, last_no) values (p_rid, v_fy, 1)
  on conflict (restaurant_id, fy) do update set last_no = public.invoice_counters.last_no + 1 returning last_no into v_no;
  v_number := h.invoice_prefix || '/' || v_fy || '/' || lpad(v_no::text, 4, '0');
  insert into public.invoices (restaurant_id, stay_id, number, issued_by, total_paise, snapshot)
  values (p_rid, p_stay, v_number, auth.uid(), (v_folio->>'total_paise')::bigint,
          jsonb_build_object('hotel', jsonb_build_object('name', r.name, 'legal_name', h.legal_name, 'gstin', h.gstin, 'address', h.bill_address, 'terms', h.invoice_terms), 'folio', v_folio));
  return v_number;
end $$;
revoke all on function private.invoice_issue(uuid, uuid) from public, anon;

-- the guest leaves: nights are counted up to today, the invoice is made, and the balance must be exactly zero (otherwise nothing changes)
create or replace function public.padh_stay_checkout(p_stay uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); s public.stays; h public.hotel_settings; v_today date; v_number text; v_folio jsonb;
begin
  select * into s from public.stays where id = p_stay and restaurant_id = v_rid for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if s.status <> 'in_house' then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  v_today := (now() at time zone coalesce(h.timezone, 'Asia/Kolkata'))::date;
  update public.stays set check_out_on = greatest(v_today, (check_in_at at time zone coalesce(h.timezone, 'Asia/Kolkata'))::date + 1) where id = s.id;
  v_number := private.invoice_issue(s.id, v_rid);
  select i.snapshot->'folio' into v_folio from public.invoices i where i.stay_id = s.id;
  if (v_folio->>'total_paise')::bigint <> (select coalesce(sum(case when kind = 'refund' then -amount_paise else amount_paise end), 0) from public.stay_payments where stay_id = s.id) then
    raise exception using errcode = 'GM026', message = 'balance_due'; -- undoes the date change and the invoice number too
  end if;
  update public.stays set status = 'checked_out', checked_out_at = now() where id = s.id;
  perform public.padh_checkout_room(s.room_id); -- signs the guest out of the hotel app and ends the stay code
  perform private.write_audit(v_rid, 'padh_stay_checkout', 'stays', s.id::text, jsonb_build_object('invoice', v_number));
  return jsonb_build_object('invoice_number', v_number);
end $$;
revoke all on function public.padh_stay_checkout(uuid) from public, anon, service_role;
grant execute on function public.padh_stay_checkout(uuid) to authenticated;

-- the printable invoice of a checked-out stay
create or replace function public.padh_invoice_get(p_stay uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); i public.invoices;
begin
  select * into i from public.invoices where stay_id = p_stay and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  return jsonb_build_object('number', i.number, 'issued_at', i.issued_at, 'hotel', i.snapshot->'hotel', 'folio', i.snapshot->'folio');
end $$;
revoke all on function public.padh_invoice_get(uuid) from public, anon, service_role;
grant execute on function public.padh_invoice_get(uuid) to authenticated;

-- the old quick check-out of a room stays for hotels that do not use stays; a room with a guest checked in must be checked out from its bill
create or replace function public.padh_checkout_room(p_room uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); v_n int; v_number text;
begin
  select number into v_number from public.rooms where id = p_room and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if exists (select 1 from public.stays where room_id = p_room and status = 'in_house') then raise exception using errcode = 'GM027', message = 'stay_open'; end if;
  update public.guest_sessions set status = 'ended', ended_at = now(), end_reason = 'checkout' where restaurant_id = v_rid and room_id = p_room and status = 'active';
  get diagnostics v_n = row_count;
  update public.stay_codes set valid_until = now() where restaurant_id = v_rid and room_id = p_room and (valid_until is null or valid_until > now());
  update public.dining_tables set qr_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
   where restaurant_id = v_rid and kind = 'room' and label = 'Room ' || upper(v_number);
  perform private.write_audit(v_rid, 'padh_room_checkout', 'rooms', p_room::text, jsonb_build_object('room', v_number, 'sessions_ended', v_n));
  return jsonb_build_object('room', v_number, 'sessions_ended', v_n);
end $$;

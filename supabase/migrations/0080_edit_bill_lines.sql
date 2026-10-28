-- 0080_edit_bill_lines
-- Every line of a bill can be corrected by hand while the bill is open.
--  * Room-service dishes on a room bill: change the GST (or none), the price or the quantity of one dish, or take one dish off; each change is kept in
--    folio_item_edits (the order itself never changes) and can be put back.
--  * Charges added at the desk (and counter bills put on the room): change the words, quantity, price and GST.
--  * Counter billing: the GST can be chosen for each line of the bill (a rule or the usual rate is only the starting point).
-- Idempotent. Rollback: restore folio_calc and padh_pos_bill from 0078, padh_folio from 0078.
create table if not exists public.folio_item_edits (
  order_item_id uuid primary key references public.order_items (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  stay_id uuid not null references public.stays (id) on delete cascade,
  tax_bp int check (tax_bp is null or tax_bp between 0 and 2800),
  unit_paise int check (unit_paise is null or unit_paise between 0 and 10000000),
  qty int check (qty is null or qty between 1 and 99),
  removed boolean not null default false,
  reason text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists folio_item_edits_stay_idx on public.folio_item_edits (stay_id);
alter table public.folio_item_edits enable row level security;
revoke all on public.folio_item_edits from public, anon, authenticated;

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
           (v_nights::bigint * s.rate_paise) as amount, v_room_tid as tid, v_room_cat.sac as sac, s.check_in_at as at, null::int as bpx, null::uuid as order_id, null::uuid as line_id
    union all
    select 20, 'order', 'Room service · order #' || o.order_no || ' · ' || oi.name_en_snapshot, coalesce(e.qty, oi.qty), coalesce(e.unit_paise, oi.unit_price_paise),
           (coalesce(e.qty, oi.qty)::bigint * coalesce(e.unit_paise, oi.unit_price_paise)), v_food_cat.tax_rate_id, v_food_cat.sac, o.created_at,
           coalesce(e.tax_bp, private.rule_bp(s.restaurant_id, oi.name_en_snapshot, (select c.name_en from public.items it join public.categories c on c.id = it.category_id where it.id = oi.item_id))), o.id, oi.id
      from public.dining_tables t
      join public.table_sessions ts on ts.table_id = t.id and ts.restaurant_id = t.restaurant_id
      join public.orders o on o.session_id = ts.id and o.restaurant_id = ts.restaurant_id
      join public.order_items oi on oi.order_id = o.id and oi.restaurant_id = o.restaurant_id
      left join public.folio_item_edits e on e.order_item_id = oi.id
     where t.restaurant_id = s.restaurant_id and t.kind = 'room' and t.label = 'Room ' || upper(rm.number)
       and o.status <> 'cancelled' and o.pay_method = 'room_bill' and o.created_at >= s.check_in_at
       and (s.checked_out_at is null or o.created_at <= s.checked_out_at)
       and not exists (select 1 from public.folio_order_skips k where k.order_id = o.id and k.active)
       and not coalesce(e.removed, false)
    union all
    -- whatever the order holds beyond its dishes (a charge or a rounding): kept so the bill always equals the order
    select 20, 'order', 'Room service · order #' || o.order_no || ' · other', 1, null::int, (o.total_paise - coalesce((select sum(x.qty::bigint * x.unit_price_paise) from public.order_items x where x.order_id = o.id), 0)),
           v_food_cat.tax_rate_id, v_food_cat.sac, o.created_at, null::int, o.id, null::uuid
      from public.dining_tables t
      join public.table_sessions ts on ts.table_id = t.id and ts.restaurant_id = t.restaurant_id
      join public.orders o on o.session_id = ts.id and o.restaurant_id = ts.restaurant_id
     where t.restaurant_id = s.restaurant_id and t.kind = 'room' and t.label = 'Room ' || upper(rm.number)
       and o.status <> 'cancelled' and o.pay_method = 'room_bill' and o.created_at >= s.check_in_at
       and (s.checked_out_at is null or o.created_at <= s.checked_out_at)
       and not exists (select 1 from public.folio_order_skips k where k.order_id = o.id and k.active)
       and (o.total_paise - coalesce((select sum(x.qty::bigint * x.unit_price_paise) from public.order_items x where x.order_id = o.id), 0)) <> 0
    union all
    select 30, 'manual', f.description, f.qty, f.unit_paise, (f.qty::bigint * f.unit_paise), c.tax_rate_id, c.sac, f.posted_at, f.tax_bp_override, null::uuid, f.id
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
           e.tax_rate_id as tid, null::text as sac, s.check_in_at as at, null::int as bpx, null::uuid as order_id, null::uuid as line_id
      from public.bill_extras e where e.restaurant_id = s.restaurant_id and e.active
  ), allines as (
    select * from base union all select * from ex where amount <> 0
  ), withtax as (
    select a.*, coalesce(a.bpx, tr.rate_bp, 0) as bp from allines a left join public.tax_rates tr on tr.id = a.tid
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('src', w.src, 'description', w.description, 'qty', w.qty, 'unit_paise', w.unit_paise, 'amount_paise', w.amount, 'tax_bp', w.bp, 'sac', w.sac, 'at', w.at, 'order_id', w.order_id, 'line_id', w.line_id) order by w.ord, w.at, w.description), '[]'::jsonb) from withtax w),
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
                         from public.folio_lines f where f.stay_id = s.id and f.voided_at is null), '[]'::jsonb),
    'skipped_orders', coalesce((select jsonb_agg(jsonb_build_object('order_id', k.order_id, 'order_no', o.order_no, 'total_paise', o.total_paise, 'reason', k.reason) order by o.created_at)
                         from public.folio_order_skips k join public.orders o on o.id = k.order_id where k.stay_id = s.id and k.active), '[]'::jsonb),
    'removed_items', coalesce((select jsonb_agg(jsonb_build_object('item_id', e.order_item_id, 'name', oi.name_en_snapshot, 'qty', oi.qty, 'unit_paise', oi.unit_price_paise, 'order_no', o.order_no) order by o.created_at)
                         from public.folio_item_edits e join public.order_items oi on oi.id = e.order_item_id join public.orders o on o.id = oi.order_id where e.stay_id = s.id and e.removed), '[]'::jsonb));
end $$;
revoke all on function public.padh_folio(uuid, boolean) from public, anon, service_role;
grant execute on function public.padh_folio(uuid, boolean) to authenticated;

create or replace function public.padh_pos_bill(p_lines text, p_label text, p_customer text, p_mode text, p_stay uuid, p_tax_bp int, p_service_bp int, p_discount_paise int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.billing_staff(); v_label text := private.bill_text(p_label); v_cust text := private.bill_text(p_customer); v_in jsonb; v_out jsonb; v_sub bigint; v_bp int;
  v_disc bigint := coalesce(p_discount_paise, 0); v_sbp int := coalesce(p_service_bp, 0); v_service bigint; v_taxable bigint; v_groups jsonb;
  v_tax bigint; v_grand bigint; v_total bigint; v_round bigint; v_today date; v_fy text; v_no int; v_number text; v_id uuid; v_ids uuid[] := '{}'; v_line uuid; h public.hotel_settings; v_food uuid; g record; v_many boolean;
begin
  begin v_in := p_lines::jsonb; exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  if jsonb_typeof(v_in) <> 'array' or jsonb_array_length(v_in) not between 1 and 60 or p_mode is null or p_mode not in ('cash','card','upi','bank','room')
     or (v_label is not null and char_length(v_label) > 40) or (v_cust is not null and char_length(v_cust) > 80) or (p_mode = 'room') <> (p_stay is not null)
     or v_sbp not between 0 and 3000 or v_disc < 0 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_stay is not null and not exists (select 1 from public.stays where id = p_stay and restaurant_id = v_rid and status = 'in_house') then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if not private.rl_hit('padh_pos:' || v_rid::text, 1500, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  perform private.billing_defaults(v_rid);
  select tr.rate_bp, c.id into v_bp, v_food from public.charge_categories c left join public.tax_rates tr on tr.id = c.tax_rate_id where c.restaurant_id = v_rid and c.kind = 'food';
  v_bp := coalesce(v_bp, 0);
  if p_tax_bp is not null and p_tax_bp <> 0 and not exists (select 1 from public.tax_rates where restaurant_id = v_rid and active and rate_bp = p_tax_bp) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  -- a rate chosen for one line must be none or one of the hotel's own rates
  if exists (select 1 from jsonb_array_elements(v_in) e where e->>'tax_bp' is not null and ((e->>'tax_bp') !~ '^[0-9]{1,4}$'
        or ((e->>'tax_bp')::int <> 0 and not exists (select 1 from public.tax_rates r where r.restaurant_id = v_rid and r.active and r.rate_bp = (e->>'tax_bp')::int)))) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  begin
    select jsonb_agg(jsonb_build_object('name', x.name, 'qty', x.qty, 'unit_paise', x.unit, 'amount_paise', x.qty::bigint * x.unit,
             'tax_bp', coalesce(p_tax_bp, x.lbp, private.rule_bp(v_rid, x.name, x.section), v_bp)) order by x.ord) into v_out from (
      select o.ord, coalesce(i.name_en, private.bill_text(e->>'name')) as name, (e->>'qty')::int as qty, coalesce(i.price_paise, (e->>'unit_paise')::int) as unit, c.name_en as section, (e->>'tax_bp')::int as lbp
        from jsonb_array_elements(v_in) with ordinality o(e, ord)
        left join public.items i on i.id = nullif(e->>'item', '')::uuid and i.restaurant_id = v_rid
        left join public.categories c on c.id = i.category_id) x;
  exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  if exists (select 1 from jsonb_array_elements(v_out) l where (l->>'name') is null or char_length(l->>'name') > 80 or (l->>'qty')::int not between 1 and 99 or (l->>'unit_paise')::int not between 1 and 10000000) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select sum((l->>'amount_paise')::bigint) into v_sub from jsonb_array_elements(v_out) l;
  if v_disc >= v_sub then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  v_service := ((v_sub - v_disc) * v_sbp + 5000) / 10000;
  v_taxable := v_sub - v_disc + v_service;
  -- share the discount, then the service charge, over the lines; then the tax per rate
  with l as (select o.ord::int as idx, (e->>'amount_paise')::bigint as amt, (e->>'tax_bp')::int as bp from jsonb_array_elements(v_out) with ordinality o(e, ord)),
  d as (select l.*, floor(v_disc::numeric * amt / v_sub)::bigint as dd from l),
  n as (select d.*, amt - (dd + case when idx = 1 then v_disc - (select sum(dd) from d) else 0 end) as net from d),
  s as (select n.*, floor(v_service::numeric * net / (v_sub - v_disc))::bigint as sv from n),
  t as (select s.bp, sum(s.net + s.sv + case when s.idx = 1 then v_service - (select sum(sv) from s) else 0 end)::bigint as taxable from s group by s.bp)
  select jsonb_agg(jsonb_build_object('tax_bp', t.bp, 'taxable_paise', t.taxable, 'tax_paise', case when t.bp > 0 then 2 * private.gst_half(t.taxable, t.bp) else 0 end) order by t.bp) into v_groups from t;
  select coalesce(sum((x->>'tax_paise')::bigint), 0) into v_tax from jsonb_array_elements(v_groups) x;
  v_grand := v_taxable + v_tax;
  v_total := case when h.round_off then ((v_grand + 50) / 100) * 100 else v_grand end;
  v_round := v_total - v_grand;
  v_today := private.hotel_today(v_rid);
  v_fy := private.fy_of(v_today);
  insert into public.pos_counters (restaurant_id, fy, last_no) values (v_rid, v_fy, 1) on conflict (restaurant_id, fy) do update set last_no = public.pos_counters.last_no + 1 returning last_no into v_no;
  v_number := 'POS/' || v_fy || '/' || lpad(v_no::text, 4, '0');
  if p_stay is not null then
    -- on a room bill the room's own folio adds the tax, so the amount before tax (after discount, with service charge) goes there: one line for each rate
    v_many := jsonb_array_length(v_groups) > 1;
    for g in select (x->>'tax_bp')::int as bp, (x->>'taxable_paise')::bigint as taxable from jsonb_array_elements(v_groups) x order by 1 loop
      insert into public.folio_lines (restaurant_id, stay_id, category_id, description, qty, unit_paise, tax_bp_override, created_by)
      values (v_rid, p_stay, v_food, 'Restaurant bill ' || v_number || case when v_many then ' · ' || case when g.bp = 0 then 'no GST' else trim(trailing '.' from trim(trailing '0' from (g.bp / 100.0)::numeric(5,2)::text)) || '% GST' end else '' end,
              1, least(g.taxable, 10000000)::int, g.bp, auth.uid()) returning id into v_line;
      v_ids := v_ids || v_line;
    end loop;
  end if;
  insert into public.pos_bills (restaurant_id, number, label, customer, lines, subtotal_paise, discount_paise, service_bp, service_paise, tax_bp, tax_paise, tax_groups, round_paise, total_paise, pay_mode, stay_id, folio_line_id, folio_line_ids, created_by)
  values (v_rid, v_number, v_label, v_cust, v_out, v_sub, v_disc, v_sbp, v_service, (select max((x->>'tax_bp')::int) from jsonb_array_elements(v_groups) x), v_tax, v_groups, v_round, v_total, p_mode, p_stay, v_ids[1], nullif(v_ids, '{}'), auth.uid()) returning id into v_id;
  perform private.write_audit(v_rid, 'padh_pos_create', 'pos_bills', v_id::text, jsonb_build_object('number', v_number, 'total_paise', v_total, 'mode', p_mode));
  return jsonb_build_object('id', v_id, 'number', v_number, 'total_paise', v_total);
end $$;
revoke all on function public.padh_pos_bill(text, text, text, text, uuid, int, int, int) from public, anon, service_role;
grant execute on function public.padh_pos_bill(text, text, text, text, uuid, int, int, int) to authenticated;

-- ---------- edit one dish of a room-service order on the bill ----------
-- p_tax_bp null = by the hotel's rules; p_unit_paise / p_qty null = as ordered; p_removed true = off the bill (the reason is then needed); all null and false = back as ordered
create or replace function public.padh_folio_item_edit(p_stay uuid, p_item uuid, p_tax_bp int, p_unit_paise int, p_qty int, p_removed boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_reason text := private.bill_text(p_reason); s public.stays; oi public.order_items; v_removed boolean := coalesce(p_removed, false);
begin
  if (p_unit_paise is not null and p_unit_paise not between 0 and 10000000) or (p_qty is not null and p_qty not between 1 and 99) or (v_reason is not null and char_length(v_reason) > 200) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if v_removed and v_reason is null then raise exception using errcode = 'GM014', message = 'reason_required'; end if;
  if p_tax_bp is not null and p_tax_bp <> 0 and not exists (select 1 from public.tax_rates where restaurant_id = v_rid and active and rate_bp = p_tax_bp) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into s from public.stays where id = p_stay and restaurant_id = v_rid and status = 'in_house' for update;
  if not found or exists (select 1 from public.invoices where stay_id = s.id) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select * into oi from public.order_items where id = p_item and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  -- the dish must be on this bill now, or be one that was taken off it
  if not exists (select 1 from jsonb_array_elements(private.folio_calc(s.id)->'lines') l where l->>'line_id' = p_item::text)
     and not exists (select 1 from public.folio_item_edits where order_item_id = p_item and stay_id = s.id and removed) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  insert into public.folio_item_edits (order_item_id, restaurant_id, stay_id, tax_bp, unit_paise, qty, removed, reason, updated_by)
  values (p_item, v_rid, s.id, p_tax_bp, p_unit_paise, p_qty, v_removed, v_reason, auth.uid())
  on conflict (order_item_id) do update set tax_bp = excluded.tax_bp, unit_paise = excluded.unit_paise, qty = excluded.qty, removed = excluded.removed, reason = excluded.reason, updated_by = excluded.updated_by, updated_at = now();
  perform private.write_audit(v_rid, 'padh_folio_item_edit', 'order_items', p_item::text, jsonb_build_object('stay', s.id, 'tax_bp', p_tax_bp, 'unit_paise', p_unit_paise, 'qty', p_qty, 'removed', v_removed, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_folio_item_edit(uuid, uuid, int, int, int, boolean, text) from public, anon, service_role;
grant execute on function public.padh_folio_item_edit(uuid, uuid, int, int, int, boolean, text) to authenticated;

-- ---------- edit a charge added at the desk ----------
-- p_tax_bp: -1 = the tax of its kind of charge again; 0 = no tax; or one of the hotel's own rates
create or replace function public.padh_folio_line_edit(p_line uuid, p_description text, p_qty int, p_unit_paise int, p_tax_bp int) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_desc text := private.bill_text(p_description); v_id uuid;
begin
  if v_desc is null or char_length(v_desc) > 120 or p_qty is null or p_qty not between 1 and 99 or p_unit_paise is null or p_unit_paise = 0 or p_unit_paise not between -10000000 and 10000000 or p_tax_bp is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_tax_bp > 0 and not exists (select 1 from public.tax_rates where restaurant_id = v_rid and active and rate_bp = p_tax_bp) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if p_tax_bp < -1 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.folio_lines f set description = v_desc, qty = p_qty, unit_paise = p_unit_paise, tax_bp_override = case when p_tax_bp = -1 then null else p_tax_bp end
   where f.id = p_line and f.restaurant_id = v_rid and f.voided_at is null
     and exists (select 1 from public.stays s where s.id = f.stay_id and s.status = 'in_house' and not exists (select 1 from public.invoices i where i.stay_id = s.id))
  returning f.id into v_id;
  if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  perform private.write_audit(v_rid, 'padh_folio_line_edit', 'folio_lines', v_id::text, jsonb_build_object('qty', p_qty, 'unit_paise', p_unit_paise, 'tax_bp', p_tax_bp));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_folio_line_edit(uuid, text, int, int, int) from public, anon, service_role;
grant execute on function public.padh_folio_line_edit(uuid, text, int, int, int) to authenticated;

-- 0078_menu_gst_rules
-- GST by menu word, and crossing out a room-service order.
--  * tax_rules: the hotel lists a word (beer, whisky, bar ...) and a GST rate for it (0 = no GST). A dish is taxed by the rule whose word is in its
--    name or in its section's name (longest word wins); a dish no rule matches is taxed as the hotel's usual food rate. Nothing is removed: a rule is switched off.
--  * Room-service orders now appear on the room bill dish by dish, each taxed by those rules, so food from the bar and food from the kitchen can differ.
--  * folio_order_skips: the desk can cross out a whole room-service order from an open bill (with a reason) and bring it back.
--  * Counter billing (POS) taxes every line by the same rules unless the cashier picks one rate for the whole bill; discount and service charge are shared out
--    across the lines in proportion to their amount, and the tax is worked out per rate.
-- Idempotent. Rollback: restore folio_calc from 0076/0067 and padh_pos_bill from 0076.
create table if not exists public.tax_rules (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  word text not null,
  rate_bp int not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint tax_rules_word_fmt check (word ~ '^[a-z0-9][a-z0-9 ]{1,28}$'),
  constraint tax_rules_rate check (rate_bp between 0 and 2800),
  constraint tax_rules_uq unique (restaurant_id, word)
);
alter table public.tax_rules enable row level security;
revoke all on public.tax_rules from public, anon, authenticated;

create table if not exists public.folio_order_skips (
  order_id uuid primary key references public.orders (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  stay_id uuid not null references public.stays (id) on delete cascade,
  reason text not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists folio_order_skips_stay_idx on public.folio_order_skips (stay_id) where active;
alter table public.folio_order_skips enable row level security;
revoke all on public.folio_order_skips from public, anon, authenticated;

alter table public.folio_lines add column if not exists tax_bp_override int;
alter table public.pos_bills add column if not exists tax_groups jsonb;
alter table public.pos_bills add column if not exists folio_line_ids uuid[];

-- the GST rate (basis points) a dish falls under by the hotel's word rules, or null when no rule fits
create or replace function private.rule_bp(p_rid uuid, p_name text, p_section text) returns int
language sql stable security definer set search_path = '' as $$
  select r.rate_bp from public.tax_rules r
   where r.restaurant_id = p_rid and r.active
     and (lower(coalesce(p_name, '')) ~ ('\m' || r.word || '(s|es)?\M') or lower(coalesce(p_section, '')) ~ ('\m' || r.word || '(s|es)?\M'))
   order by char_length(r.word) desc, r.word limit 1
$$;
revoke all on function private.rule_bp(uuid, text, text) from public, anon, authenticated;

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
           (v_nights::bigint * s.rate_paise) as amount, v_room_tid as tid, v_room_cat.sac as sac, s.check_in_at as at, null::int as bpx, null::uuid as order_id
    union all
    select 20, 'order', 'Room service · order #' || o.order_no || ' · ' || oi.name_en_snapshot, oi.qty, oi.unit_price_paise, (oi.qty::bigint * oi.unit_price_paise), v_food_cat.tax_rate_id, v_food_cat.sac, o.created_at,
           private.rule_bp(s.restaurant_id, oi.name_en_snapshot, (select c.name_en from public.items it join public.categories c on c.id = it.category_id where it.id = oi.item_id)), o.id
      from public.dining_tables t
      join public.table_sessions ts on ts.table_id = t.id and ts.restaurant_id = t.restaurant_id
      join public.orders o on o.session_id = ts.id and o.restaurant_id = ts.restaurant_id
      join public.order_items oi on oi.order_id = o.id and oi.restaurant_id = o.restaurant_id
     where t.restaurant_id = s.restaurant_id and t.kind = 'room' and t.label = 'Room ' || upper(rm.number)
       and o.status <> 'cancelled' and o.pay_method = 'room_bill' and o.created_at >= s.check_in_at
       and (s.checked_out_at is null or o.created_at <= s.checked_out_at)
       and not exists (select 1 from public.folio_order_skips k where k.order_id = o.id and k.active)
    union all
    -- whatever the order holds beyond its dishes (a charge or a rounding): kept so the bill always equals the order
    select 20, 'order', 'Room service · order #' || o.order_no || ' · other', 1, null::int, (o.total_paise - coalesce((select sum(x.qty::bigint * x.unit_price_paise) from public.order_items x where x.order_id = o.id), 0)),
           v_food_cat.tax_rate_id, v_food_cat.sac, o.created_at, null::int, o.id
      from public.dining_tables t
      join public.table_sessions ts on ts.table_id = t.id and ts.restaurant_id = t.restaurant_id
      join public.orders o on o.session_id = ts.id and o.restaurant_id = ts.restaurant_id
     where t.restaurant_id = s.restaurant_id and t.kind = 'room' and t.label = 'Room ' || upper(rm.number)
       and o.status <> 'cancelled' and o.pay_method = 'room_bill' and o.created_at >= s.check_in_at
       and (s.checked_out_at is null or o.created_at <= s.checked_out_at)
       and not exists (select 1 from public.folio_order_skips k where k.order_id = o.id and k.active)
       and (o.total_paise - coalesce((select sum(x.qty::bigint * x.unit_price_paise) from public.order_items x where x.order_id = o.id), 0)) <> 0
    union all
    select 30, 'manual', f.description, f.qty, f.unit_paise, (f.qty::bigint * f.unit_paise), c.tax_rate_id, c.sac, f.posted_at, f.tax_bp_override, null::uuid
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
           e.tax_rate_id as tid, null::text as sac, s.check_in_at as at, null::int as bpx, null::uuid as order_id
      from public.bill_extras e where e.restaurant_id = s.restaurant_id and e.active
  ), allines as (
    select * from base union all select * from ex where amount <> 0
  ), withtax as (
    select a.*, coalesce(a.bpx, tr.rate_bp, 0) as bp from allines a left join public.tax_rates tr on tr.id = a.tid
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object('src', w.src, 'description', w.description, 'qty', w.qty, 'unit_paise', w.unit_paise, 'amount_paise', w.amount, 'tax_bp', w.bp, 'sac', w.sac, 'at', w.at, 'order_id', w.order_id) order by w.ord, w.at, w.description), '[]'::jsonb) from withtax w),
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

-- the bill of a stay, plus the room-service orders crossed out of it (so they can be brought back)
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
                         from public.folio_order_skips k join public.orders o on o.id = k.order_id where k.stay_id = s.id and k.active), '[]'::jsonb));
end $$;
revoke all on function public.padh_folio(uuid, boolean) from public, anon, service_role;
grant execute on function public.padh_folio(uuid, boolean) to authenticated;

-- cross a room-service order out of an open bill (p_skip true) or bring it back (false)
create or replace function public.padh_folio_order_skip(p_stay uuid, p_order uuid, p_skip boolean, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_reason text := private.bill_text(p_reason); s public.stays; k public.folio_order_skips;
begin
  if p_skip is null or (p_skip and (v_reason is null or char_length(v_reason) > 200)) then raise exception using errcode = 'GM014', message = 'reason_required'; end if;
  select * into s from public.stays where id = p_stay and restaurant_id = v_rid and status = 'in_house' for update;
  if not found or exists (select 1 from public.invoices where stay_id = s.id) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if p_skip then
    -- only an order that is on this bill right now can be crossed out
    if not exists (select 1 from jsonb_array_elements(private.folio_calc(s.id)->'lines') l where l->>'order_id' = p_order::text) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
    insert into public.folio_order_skips (order_id, restaurant_id, stay_id, reason, active, created_by) values (p_order, v_rid, s.id, v_reason, true, auth.uid())
      on conflict (order_id) do update set active = true, reason = excluded.reason, stay_id = excluded.stay_id, created_by = excluded.created_by, created_at = now();
  else
    update public.folio_order_skips set active = false where order_id = p_order and stay_id = s.id and active returning * into k;
    if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  perform private.write_audit(v_rid, case when p_skip then 'padh_folio_order_skip' else 'padh_folio_order_restore' end, 'orders', p_order::text, jsonb_build_object('stay', s.id, 'reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_folio_order_skip(uuid, uuid, boolean, text) from public, anon, service_role;
grant execute on function public.padh_folio_order_skip(uuid, uuid, boolean, text) to authenticated;

-- ---------- GST rules ----------
create or replace function public.padh_tax_rules_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff();
begin
  perform private.billing_defaults(v_rid);
  return jsonb_build_object(
    'usual_bp', coalesce((select tr.rate_bp from public.charge_categories c join public.tax_rates tr on tr.id = c.tax_rate_id where c.restaurant_id = v_rid and c.kind = 'food'), 0),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('name', t.name, 'rate_bp', t.rate_bp) order by t.rate_bp) from public.tax_rates t where t.restaurant_id = v_rid and t.active), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'word', r.word, 'rate_bp', r.rate_bp, 'active', r.active) order by r.word) from public.tax_rules r where r.restaurant_id = v_rid), '[]'::jsonb));
end $$;
revoke all on function public.padh_tax_rules_get() from public, anon, service_role;
grant execute on function public.padh_tax_rules_get() to authenticated;

create or replace function public.padh_tax_rule_save(p_word text, p_rate_bp int, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_word text := lower(regexp_replace(btrim(coalesce(p_word, '')), '\s+', ' ', 'g')); v_id uuid;
begin
  if v_word !~ '^[a-z0-9][a-z0-9 ]{1,28}$' or p_rate_bp is null or p_active is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if p_rate_bp <> 0 and not exists (select 1 from public.tax_rates where restaurant_id = v_rid and active and rate_bp = p_rate_bp) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if (select count(*) from public.tax_rules where restaurant_id = v_rid) >= 80 and not exists (select 1 from public.tax_rules where restaurant_id = v_rid and word = v_word) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  insert into public.tax_rules (restaurant_id, word, rate_bp, active) values (v_rid, v_word, p_rate_bp, p_active)
    on conflict (restaurant_id, word) do update set rate_bp = excluded.rate_bp, active = excluded.active returning id into v_id;
  perform private.write_audit(v_rid, 'padh_tax_rule_save', 'tax_rules', v_id::text, jsonb_build_object('word', v_word, 'rate_bp', p_rate_bp, 'active', p_active));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_tax_rule_save(text, int, boolean) from public, anon, service_role;
grant execute on function public.padh_tax_rule_save(text, int, boolean) to authenticated;

-- the counter's menu: the usual food rate, the active word rules, every rate that can be picked
create or replace function public.padh_pos_menu() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff();
begin
  perform private.billing_defaults(v_rid);
  return jsonb_build_object(
    'tax_bp', coalesce((select tr.rate_bp from public.charge_categories c join public.tax_rates tr on tr.id = c.tax_rate_id where c.restaurant_id = v_rid and c.kind = 'food'), 0),
    'tax_rates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'rate_bp', t.rate_bp) order by t.rate_bp) from public.tax_rates t where t.restaurant_id = v_rid and t.active), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(jsonb_build_object('word', r.word, 'rate_bp', r.rate_bp)) from public.tax_rules r where r.restaurant_id = v_rid and r.active), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name_en, 'items', coalesce((
        select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name_en, 'price_paise', i.price_paise, 'diet', i.diet, 'available', i.is_available) order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = v_rid), '[]'::jsonb)) order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = v_rid and c.active), '[]'::jsonb));
end $$;
revoke all on function public.padh_pos_menu() from public, anon, service_role;
grant execute on function public.padh_pos_menu() to authenticated;

-- ---------- counter billing with per-line GST ----------
-- p_tax_bp null = every dish by the hotel's word rules (else the usual food rate); a number = that one rate for the whole bill (0 = none, else one of the hotel's active rates).
-- The discount and the service charge are shared out over the lines in proportion to their amount (whole paise, the odd paise on the first line); the tax is worked out per rate.
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
  begin
    select jsonb_agg(jsonb_build_object('name', x.name, 'qty', x.qty, 'unit_paise', x.unit, 'amount_paise', x.qty::bigint * x.unit,
             'tax_bp', coalesce(p_tax_bp, private.rule_bp(v_rid, x.name, x.section), v_bp)) order by x.ord) into v_out from (
      select o.ord, coalesce(i.name_en, private.bill_text(e->>'name')) as name, (e->>'qty')::int as qty, coalesce(i.price_paise, (e->>'unit_paise')::int) as unit, c.name_en as section
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
    'tax_groups', coalesce(b.tax_groups, case when b.tax_paise > 0 then jsonb_build_array(jsonb_build_object('tax_bp', b.tax_bp, 'taxable_paise', b.subtotal_paise - b.discount_paise + b.service_paise, 'tax_paise', b.tax_paise)) else '[]'::jsonb end),
    'round_paise', b.round_paise, 'total_paise', b.total_paise, 'pay_mode', b.pay_mode, 'status', b.status, 'void_reason', b.void_reason, 'room', s.room, 'guest', s.guest,
    'hotel', jsonb_build_object('name', r.name, 'legal_name', h.legal_name, 'gstin', h.gstin, 'address', h.bill_address));
end $$;
revoke all on function public.padh_pos_get(uuid) from public, anon, service_role;
grant execute on function public.padh_pos_get(uuid) to authenticated;

-- a wrong bill is cancelled with a reason; a bill put on a room's bill comes off it (every line it made) while the guest is still in the hotel
create or replace function public.padh_pos_void(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_reason text := private.bill_text(p_reason); b public.pos_bills; v_n int;
begin
  if v_reason is null or char_length(v_reason) > 200 then raise exception using errcode = 'GM014', message = 'reason_required'; end if;
  select * into b from public.pos_bills where id = p_id and restaurant_id = v_rid and status = 'paid' for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if b.folio_line_id is not null then
    update public.folio_lines set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
     where id = any(coalesce(b.folio_line_ids, array[b.folio_line_id])) and voided_at is null and exists (select 1 from public.stays s where s.id = stay_id and s.status = 'in_house');
    get diagnostics v_n = row_count;
    if v_n = 0 then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  end if;
  update public.pos_bills set status = 'void', void_reason = v_reason where id = p_id;
  perform private.write_audit(v_rid, 'padh_pos_void', 'pos_bills', p_id::text, jsonb_build_object('reason', v_reason));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_pos_void(uuid, text) from public, anon, service_role;
grant execute on function public.padh_pos_void(uuid, text) to authenticated;

-- ---------- check-in time ----------
-- The desk can set the time the guest actually arrived (today, HH:MM in the hotel's own time; never later than now).
create or replace function public.padh_stay_set_checkin(p_stay uuid, p_time text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.billing_staff(); v_tz text; v_at timestamptz; s public.stays;
begin
  if p_time is null or p_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  select * into s from public.stays where id = p_stay and restaurant_id = v_rid and status = 'in_house' for update;
  if not found or exists (select 1 from public.invoices where stay_id = s.id) then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select coalesce(timezone, 'Asia/Kolkata') into v_tz from public.hotel_settings where restaurant_id = v_rid;
  v_at := ((now() at time zone coalesce(v_tz, 'Asia/Kolkata'))::date + p_time::time) at time zone coalesce(v_tz, 'Asia/Kolkata');
  v_at := least(v_at, now()); -- a clock a few minutes ahead never puts the arrival in the future
  update public.stays set check_in_at = v_at where id = s.id;
  perform private.write_audit(v_rid, 'padh_stay_set_checkin', 'stays', s.id::text, jsonb_build_object('time', p_time));
  return jsonb_build_object('check_in_at', v_at);
end $$;
revoke all on function public.padh_stay_set_checkin(uuid, text) from public, anon, service_role;
grant execute on function public.padh_stay_set_checkin(uuid, text) to authenticated;

-- 0066_billing_setup
-- The functions that set up billing: room types and rates, tax rates, charge categories, the room tax rule, extra charges and the invoice
-- details. Reading is for reception, manager and owner; CHANGING anything is for the owner and manager only. Nothing here is a default
-- the hotel cannot change: the tax rates start empty (a button adds a template of common rates to pick from).
-- Idempotent. Rollback: drop these functions.

-- the four starting categories of a hotel (no tax attached until the owner chooses one)
create or replace function private.billing_defaults(p_rid uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.charge_categories (restaurant_id, kind, name, sort)
  values (p_rid, 'room', 'Room rent', 10), (p_rid, 'food', 'Food & beverage', 20), (p_rid, 'other', 'Laundry', 30), (p_rid, 'other', 'Other charges', 40)
  on conflict do nothing
$$;
revoke all on function private.billing_defaults(uuid) from public, anon;

-- whole-number tax in paise: half of the rate for each of CGST and SGST (rounded half up), or all of it for IGST
create or replace function private.gst_half(t bigint, bp int) returns bigint
language sql immutable set search_path = '' as $$ select (case when t < 0 then -1 else 1 end) * ((abs(t) * bp + 10000) / 20000) $$;
create or replace function private.gst_full(t bigint, bp int) returns bigint
language sql immutable set search_path = '' as $$ select (case when t < 0 then -1 else 1 end) * ((abs(t) * bp + 5000) / 10000) $$;

-- a plain text from the desk: no control characters, trimmed
create or replace function private.bill_text(p text) returns text
language sql immutable set search_path = '' as $$ select nullif(btrim(regexp_replace(coalesce(p, ''), '[[:cntrl:]]', '', 'g')), '') $$;

-- everything the setup screen and the desk need, in one call
create or replace function public.padh_billing_get() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager','waiter']); h public.hotel_settings;
begin
  if not private.sees_everything() then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  select * into h from public.hotel_settings where restaurant_id = v_rid;
  perform private.billing_defaults(v_rid);
  return jsonb_build_object(
    'settings', jsonb_build_object('legal_name', h.legal_name, 'gstin', h.gstin, 'address', h.bill_address, 'prefix', h.invoice_prefix, 'terms', h.invoice_terms, 'round_off', h.round_off),
    'room_types', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'rate_paise', t.rate_paise, 'max_guests', t.max_guests, 'active', t.active) order by t.name) from public.room_types t where t.restaurant_id = v_rid), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'room_type_id', r.room_type_id, 'active', r.active) order by r.number) from public.rooms r where r.restaurant_id = v_rid), '[]'::jsonb),
    'tax_rates', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'rate_bp', t.rate_bp, 'active', t.active) order by t.rate_bp, t.name) from public.tax_rates t where t.restaurant_id = v_rid), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind, 'name', c.name, 'sac', c.sac, 'tax_rate_id', c.tax_rate_id, 'active', c.active) order by c.sort, c.name) from public.charge_categories c where c.restaurant_id = v_rid), '[]'::jsonb),
    'slabs', coalesce((select jsonb_agg(jsonb_build_object('up_to_paise', s.up_to_paise, 'tax_rate_id', s.tax_rate_id) order by s.up_to_paise nulls last) from public.room_tax_slabs s where s.restaurant_id = v_rid and s.active), '[]'::jsonb),
    'extras', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'mode', e.mode, 'value', e.value, 'applies_to', e.applies_to, 'tax_rate_id', e.tax_rate_id, 'active', e.active) order by e.name) from public.bill_extras e where e.restaurant_id = v_rid), '[]'::jsonb));
end $$;
revoke all on function public.padh_billing_get() from public, anon, service_role;
grant execute on function public.padh_billing_get() to authenticated;

-- ---------- owner / manager: change the setup ----------
create or replace function public.padh_tax_rate_save(p_id uuid, p_name text, p_rate_bp int, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_name text := private.bill_text(p_name); v_id uuid;
begin
  if v_name is null or char_length(v_name) > 40 or p_rate_bp is null or p_rate_bp not between 0 and 10000 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.tax_rates where restaurant_id = v_rid) >= 40 and p_id is null then raise exception using errcode = 'GM006', message = 'limit_exceeded'; end if;
  if exists (select 1 from public.tax_rates where restaurant_id = v_rid and name = v_name and id is distinct from p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  if p_id is null then
    insert into public.tax_rates (restaurant_id, name, rate_bp, active) values (v_rid, v_name, p_rate_bp, p_active) returning id into v_id;
  else
    update public.tax_rates set name = v_name, rate_bp = p_rate_bp, active = p_active where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  perform private.write_audit(v_rid, 'padh_tax_rate_save', 'tax_rates', v_id::text, jsonb_build_object('name', v_name, 'rate_bp', p_rate_bp, 'active', p_active));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_tax_rate_save(uuid, text, int, boolean) from public, anon, service_role;
grant execute on function public.padh_tax_rate_save(uuid, text, int, boolean) to authenticated;

-- a ready list of common rates (0, 5, 12 and 18 percent) to choose from; the hotel decides which one each charge uses
create or replace function public.padh_tax_presets_add() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_n int;
begin
  insert into public.tax_rates (restaurant_id, name, rate_bp) values (v_rid, 'GST 0%', 0), (v_rid, 'GST 5%', 500), (v_rid, 'GST 12%', 1200), (v_rid, 'GST 18%', 1800)
  on conflict (restaurant_id, name) do nothing;
  get diagnostics v_n = row_count;
  perform private.write_audit(v_rid, 'padh_tax_presets_add', 'tax_rates', v_rid::text, jsonb_build_object('added', v_n));
  return jsonb_build_object('added', v_n);
end $$;
revoke all on function public.padh_tax_presets_add() from public, anon, service_role;
grant execute on function public.padh_tax_presets_add() to authenticated;

-- p_id null = a new "other" category. The room and food categories always exist; only their name, SAC code and tax can change.
create or replace function public.padh_category_save(p_id uuid, p_name text, p_sac text, p_tax_rate uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_name text := private.bill_text(p_name); v_sac text := nullif(btrim(coalesce(p_sac, '')), ''); v_id uuid; c public.charge_categories;
begin
  if v_name is null or char_length(v_name) > 40 or (v_sac is not null and v_sac !~ '^[0-9]{4,8}$') or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_tax_rate is not null and not exists (select 1 from public.tax_rates where id = p_tax_rate and restaurant_id = v_rid) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from public.charge_categories where restaurant_id = v_rid and name = v_name and id is distinct from p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  if p_id is null then
    if (select count(*) from public.charge_categories where restaurant_id = v_rid) >= 40 then raise exception using errcode = 'GM006', message = 'limit_exceeded'; end if;
    insert into public.charge_categories (restaurant_id, kind, name, sac, tax_rate_id, active) values (v_rid, 'other', v_name, v_sac, p_tax_rate, p_active) returning id into v_id;
  else
    select * into c from public.charge_categories where id = p_id and restaurant_id = v_rid;
    if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
    if c.kind <> 'other' and not p_active then raise exception using errcode = 'GM020', message = 'protected'; end if;
    update public.charge_categories set name = v_name, sac = v_sac, tax_rate_id = p_tax_rate, active = p_active where id = p_id returning id into v_id;
  end if;
  perform private.write_audit(v_rid, 'padh_category_save', 'charge_categories', v_id::text, jsonb_build_object('name', v_name, 'tax_rate_id', p_tax_rate, 'active', p_active));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_category_save(uuid, text, text, uuid, boolean) from public, anon, service_role;
grant execute on function public.padh_category_save(uuid, text, text, uuid, boolean) to authenticated;

-- the room tax rule. p_items is JSON text: a list of {up_to_paise (number, or null for "everything above"), tax_rate_id}, lowest limit first.
-- An empty list switches the rule off (the room category's own tax is used).
create or replace function public.padh_slabs_set(p_items text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_items jsonb; i jsonb; k int := 0; v_prev bigint := 0; v_n int; v_up bigint;
begin
  begin v_items := p_items::jsonb; exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) > 8 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  v_n := jsonb_array_length(v_items);
  for i in select * from jsonb_array_elements(v_items) loop
    k := k + 1;
    if jsonb_typeof(i) <> 'object' or coalesce(i->>'tax_rate_id', '') !~ '^[0-9a-f-]{36}$'
       or not exists (select 1 from public.tax_rates t where t.id = (i->>'tax_rate_id')::uuid and t.restaurant_id = v_rid) then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
    if jsonb_typeof(i->'up_to_paise') = 'number' then
      v_up := (i->>'up_to_paise')::numeric::bigint;
      if v_up <= v_prev or v_up > 10000000 then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
      v_prev := v_up;
    elsif k <> v_n then
      raise exception using errcode = 'GM015', message = 'invalid_input'; -- only the last slab may have no limit
    end if;
  end loop;
  update public.room_tax_slabs set active = false where restaurant_id = v_rid and active;
  for i in select * from jsonb_array_elements(v_items) loop
    insert into public.room_tax_slabs (restaurant_id, up_to_paise, tax_rate_id)
    values (v_rid, case when jsonb_typeof(i->'up_to_paise') = 'number' then (i->>'up_to_paise')::numeric::int end, (i->>'tax_rate_id')::uuid);
  end loop;
  perform private.write_audit(v_rid, 'padh_slabs_set', 'room_tax_slabs', v_rid::text, jsonb_build_object('count', v_n));
  return jsonb_build_object('slabs', v_n);
end $$;
revoke all on function public.padh_slabs_set(text) from public, anon, service_role;
grant execute on function public.padh_slabs_set(text) to authenticated;

create or replace function public.padh_extra_save(p_id uuid, p_name text, p_mode text, p_value int, p_applies text, p_tax_rate uuid, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_name text := private.bill_text(p_name); v_id uuid;
begin
  if v_name is null or char_length(v_name) > 40 or p_mode not in ('percent','per_night','flat') or p_applies not in ('room','food','all') or p_active is null
     or p_value is null or p_value not between 0 and 10000000 or (p_mode = 'percent' and p_value > 10000) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_tax_rate is not null and not exists (select 1 from public.tax_rates where id = p_tax_rate and restaurant_id = v_rid) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from public.bill_extras where restaurant_id = v_rid and name = v_name and id is distinct from p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  if p_id is null then
    if (select count(*) from public.bill_extras where restaurant_id = v_rid) >= 20 then raise exception using errcode = 'GM006', message = 'limit_exceeded'; end if;
    insert into public.bill_extras (restaurant_id, name, mode, value, applies_to, tax_rate_id, active) values (v_rid, v_name, p_mode, p_value, p_applies, p_tax_rate, p_active) returning id into v_id;
  else
    update public.bill_extras set name = v_name, mode = p_mode, value = p_value, applies_to = p_applies, tax_rate_id = p_tax_rate, active = p_active where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  perform private.write_audit(v_rid, 'padh_extra_save', 'bill_extras', v_id::text, jsonb_build_object('name', v_name, 'mode', p_mode, 'value', p_value, 'active', p_active));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_extra_save(uuid, text, text, int, text, uuid, boolean) from public, anon, service_role;
grant execute on function public.padh_extra_save(uuid, text, text, int, text, uuid, boolean) to authenticated;

-- the details printed at the top and bottom of an invoice
create or replace function public.padh_legal_set(p_legal_name text, p_gstin text, p_address text, p_prefix text, p_terms text, p_round_off boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
  v_name text := private.bill_text(p_legal_name); v_gst text := upper(nullif(btrim(coalesce(p_gstin, '')), '')); v_addr text := private.bill_text(p_address);
  v_prefix text := upper(btrim(coalesce(p_prefix, ''))); v_terms text := private.bill_text(p_terms);
begin
  if (v_name is not null and char_length(v_name) > 120) or (v_gst is not null and v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
     or (v_addr is not null and char_length(v_addr) > 300) or v_prefix !~ '^[A-Z0-9]{1,8}$' or (v_terms is not null and char_length(v_terms) > 400) or p_round_off is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.hotel_settings set legal_name = v_name, gstin = v_gst, bill_address = v_addr, invoice_prefix = v_prefix, invoice_terms = v_terms, round_off = p_round_off, updated_at = now() where restaurant_id = v_rid;
  perform private.write_audit(v_rid, 'padh_legal_set', 'hotel_settings', v_rid::text, jsonb_build_object('gstin', v_gst, 'prefix', v_prefix, 'round_off', p_round_off));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_legal_set(text, text, text, text, text, boolean) from public, anon, service_role;
grant execute on function public.padh_legal_set(text, text, text, text, text, boolean) to authenticated;

create or replace function public.padh_room_type_save(p_id uuid, p_name text, p_rate_paise int, p_max int, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_name text := private.bill_text(p_name); v_id uuid;
begin
  if v_name is null or char_length(v_name) > 40 or p_rate_paise is null or p_rate_paise not between 0 and 10000000 or p_max is null or p_max not between 1 and 20 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from public.room_types where restaurant_id = v_rid and name = v_name and id is distinct from p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  if p_id is null then
    if (select count(*) from public.room_types where restaurant_id = v_rid) >= 30 then raise exception using errcode = 'GM006', message = 'limit_exceeded'; end if;
    insert into public.room_types (restaurant_id, name, rate_paise, max_guests, active) values (v_rid, v_name, p_rate_paise, p_max, p_active) returning id into v_id;
  else
    update public.room_types set name = v_name, rate_paise = p_rate_paise, max_guests = p_max, active = p_active where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  perform private.write_audit(v_rid, 'padh_room_type_save', 'room_types', v_id::text, jsonb_build_object('name', v_name, 'rate_paise', p_rate_paise, 'active', p_active));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_room_type_save(uuid, text, int, int, boolean) from public, anon, service_role;
grant execute on function public.padh_room_type_save(uuid, text, int, int, boolean) to authenticated;

-- p_type null = no type
create or replace function public.padh_room_set_type(p_room uuid, p_type uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_id uuid;
begin
  if p_type is not null and not exists (select 1 from public.room_types where id = p_type and restaurant_id = v_rid) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  update public.rooms set room_type_id = p_type where id = p_room and restaurant_id = v_rid returning id into v_id;
  if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  perform private.write_audit(v_rid, 'padh_room_set_type', 'rooms', v_id::text, jsonb_build_object('type', p_type));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.padh_room_set_type(uuid, uuid) from public, anon, service_role;
grant execute on function public.padh_room_set_type(uuid, uuid) to authenticated;

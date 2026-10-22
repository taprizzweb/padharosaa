-- 0024: dish sizes and options.
--   Sizes (item_variants): Small / Medium / Large / XL, or Half / Full, each with its OWN price. A dish with sizes is
--     ordered by choosing one size (the guest taps the dish and picks). The dish's own price is kept equal to the cheapest
--     size so lists, reports and "from Rs" labels keep working.
--   Options (item_option_groups + item_options): extra choices such as "Choose your sauce" (pick 1, required) or
--     "Add extras" (pick up to 3, optional), each choice with an extra price (0 allowed).
-- Prices are always computed here, never taken from the browser. The order line keeps a readable snapshot in
-- order_items.name_en_snapshot, e.g. "Oreo Shake (Large) + Extra Oreo, Choco chips", so staff screens, bills and
-- reports show it without any other change. Idempotent. Rollback: restore guest_place_order from 0005, guest_get_menu
-- from 0023, mgr_get_menu / mgr_duplicate_item / mgr_bulk_price / mgr_import_items from 0013, then drop the three tables.

-- ---------- tables ----------
create table if not exists public.item_variants (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id       uuid not null,
  name          text not null,
  price_paise   int not null,
  is_available  boolean not null default true,
  sort_order    int not null default 0,
  constraint item_variants_item_fk foreign key (item_id, restaurant_id) references public.items (id, restaurant_id) on delete cascade,
  constraint item_variants_name check (char_length(name) between 1 and 30),
  constraint item_variants_price check (price_paise between 0 and 10000000)
);
create unique index if not exists item_variants_name_uq on public.item_variants (item_id, lower(name));
create index if not exists item_variants_item_idx on public.item_variants (item_id);

create table if not exists public.item_option_groups (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id       uuid not null,
  name          text not null,
  required      boolean not null default false,
  max_select    int not null default 1,
  sort_order    int not null default 0,
  constraint item_option_groups_item_fk foreign key (item_id, restaurant_id) references public.items (id, restaurant_id) on delete cascade,
  constraint item_option_groups_id_restaurant_uq unique (id, restaurant_id),
  constraint item_option_groups_name check (char_length(name) between 1 and 40),
  constraint item_option_groups_max check (max_select between 1 and 20)
);
create index if not exists item_option_groups_item_idx on public.item_option_groups (item_id);

create table if not exists public.item_options (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  group_id          uuid not null,
  name              text not null,
  price_delta_paise int not null default 0,
  sort_order        int not null default 0,
  constraint item_options_group_fk foreign key (group_id, restaurant_id) references public.item_option_groups (id, restaurant_id) on delete cascade,
  constraint item_options_name check (char_length(name) between 1 and 40),
  constraint item_options_price check (price_delta_paise between 0 and 5000000)
);
create index if not exists item_options_group_idx on public.item_options (group_id);

-- Like every table: row level security on, no direct access for anyone; the functions below are the only way in.
alter table public.item_variants      enable row level security;
alter table public.item_option_groups enable row level security;
alter table public.item_options       enable row level security;
revoke all on public.item_variants, public.item_option_groups, public.item_options from public, anon, authenticated;

-- order lines may carry the longer readable name
alter table public.order_items drop constraint if exists order_items_name_len;
alter table public.order_items add constraint order_items_name_len check (char_length(name_en_snapshot) between 1 and 200);

-- A dish with sizes always carries its cheapest size as its own price (also when saved, bulk-changed or imported).
create or replace function private.items_keep_size_price() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_min int;
begin
  select min(price_paise) into v_min from public.item_variants where item_id = new.id;
  if v_min is not null then new.price_paise := v_min; end if;
  return new;
end $$;
revoke all on function private.items_keep_size_price() from public, anon, authenticated;
drop trigger if exists items_keep_size_price on public.items;
create trigger items_keep_size_price before update of price_paise on public.items
  for each row execute function private.items_keep_size_price();

-- ---------- guest: the menu now lists sizes and options ----------
create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
  v_room_link boolean;
  v_table_link boolean;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  v_room_link := p_token is not null and r.room_token is not null and r.room_token = p_token;
  v_table_link := p_token is not null and r.table_token is not null and r.table_token = p_token;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
    'room_link', v_room_link,
    'rooms', case when v_room_link then to_jsonb(r.room_numbers) else null end,
    'table_link', v_table_link,
    'tables', case when v_table_link then coalesce((
        select jsonb_agg(d.label order by length(d.label), d.label)
          from public.dining_tables d where d.restaurant_id = r.id and d.kind = 'table' and d.active), '[]'::jsonb) else null end,
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name_en', c.name_en, 'name_hi', c.name_hi,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name_en', i.name_en, 'name_hi', i.name_hi,
            'description_en', i.description_en, 'description_hi', i.description_hi,
            'price_paise', i.price_paise, 'diet', i.diet, 'spice', i.spice, 'image_path', i.image_path,
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick,
            'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_paise', v.price_paise, 'is_available', v.is_available)
                                  order by v.sort_order, v.price_paise)
                                    from public.item_variants v where v.item_id = i.id), '[]'::jsonb),
            'option_groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'required', g.required, 'max_select', g.max_select,
                                         'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_delta_paise', o.price_delta_paise)
                                                               order by o.sort_order, o.name)
                                                                 from public.item_options o where o.group_id = g.id), '[]'::jsonb))
                                       order by g.sort_order, g.name)
                                         from public.item_option_groups g where g.item_id = i.id), '[]'::jsonb))
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;

-- ---------- guest: place an order (lines may carry variant_id and option_ids) ----------
create or replace function public.guest_place_order(
  p_slug text, p_token text, p_items jsonb, p_note text, p_idem text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_max_lines   constant int := 25;
  c_max_qty     constant int := 10;
  c_max_total   constant bigint := 1500000;   -- Rs 15,000 in paise
  c_max_pending constant int := 3;
  c_max_per_10m constant int := 8;
  c_ip_limit    constant int := 60;
  t public.dining_tables;
  r public.restaurants;
  s public.table_sessions;
  o public.orders;
  i public.items;
  v public.item_variants;
  l record;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_total bigint := 0;
  v_lines int;
  v_order_no bigint;
  v_calc jsonb := '[]'::jsonb;
  v_unit bigint;
  v_name text;
  v_delta bigint;
  v_opt_names text;
  v_n int;
begin
  if p_ip_hash is not null and not private.rl_hit('ip:' || p_ip_hash, c_ip_limit, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  if p_slug is null or p_token is null or p_idem is null or char_length(p_idem) not between 8 and 64
     or (v_note is not null and char_length(v_note) > 200)
     or p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  v_lines := jsonb_array_length(p_items);
  if v_lines > c_max_lines then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  begin
    perform 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]);
  exception when others then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[])
             where x.item_id is null or x.qty is null or x.qty < 1 or char_length(coalesce(x.note, '')) > 100
                or coalesce(cardinality(x.option_ids), 0) > 20
                or coalesce(cardinality(x.option_ids), 0) <> (select count(distinct oo) from unnest(coalesce(x.option_ids, '{}')) oo)) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]) where x.qty > c_max_qty) then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  -- the same dish may appear twice only with a different size or different options
  if (select count(distinct x.item_id::text || '|' || coalesce(x.variant_id::text, '') || '|' ||
                     coalesce((select string_agg(oo::text, ',' order by oo::text) from unnest(x.option_ids) oo), ''))
        from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[])) <> v_lines then
    raise exception using errcode = 'GM005', message = 'duplicate_item';
  end if;

  select t2.* into t
    from public.dining_tables t2 join public.restaurants r2 on r2.id = t2.restaurant_id
   where t2.qr_token = p_token and r2.slug = p_slug and t2.active;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;

  select * into r from public.restaurants where id = t.restaurant_id for no key update;
  if r.status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;

  select * into o from public.orders
   where table_id = t.id and idempotency_key = p_idem and created_at > now() - interval '1 hour'
   limit 1;
  if found then
    return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'total_paise', o.total_paise,
      'session_id', o.session_id, 'table_label', t.label, 'status', o.status, 'replayed', true);
  end if;

  select * into s from public.table_sessions where table_id = t.id and closed_at is null for update;
  if not found then
    insert into public.table_sessions (restaurant_id, table_id) values (r.id, t.id) returning * into s;
  end if;

  if (select count(*) from public.orders where session_id = s.id and status = 'placed') >= c_max_pending then
    raise exception using errcode = 'GM008', message = 'too_many_pending';
  end if;
  if (select count(*) from public.orders where table_id = t.id and created_at > now() - interval '10 minutes') >= c_max_per_10m then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  -- lock the rows prices come from (stable order) so nothing can change before we commit
  perform 1 from public.items it
   where it.restaurant_id = r.id
     and it.id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]))
   order by it.id for share;
  perform 1 from public.item_variants iv
   where iv.restaurant_id = r.id
     and iv.item_id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]))
   order by iv.id for share;
  perform 1 from public.item_options io join public.item_option_groups ig on ig.id = io.group_id
   where io.restaurant_id = r.id
     and ig.item_id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text, variant_id uuid, option_ids uuid[]))
   order by io.id for share of io;

  -- price every line from the database
  for l in select (e.j->>'item_id')::uuid as item_id, (e.j->>'qty')::int as qty, e.j->>'note' as note,
                  nullif(e.j->>'variant_id', '')::uuid as variant_id,
                  case when jsonb_typeof(e.j->'option_ids') = 'array' then array(select jsonb_array_elements_text(e.j->'option_ids'))::uuid[] else '{}'::uuid[] end as option_ids
             from jsonb_array_elements(p_items) with ordinality e(j, ord)
            order by e.ord loop
    select * into i from public.items where id = l.item_id and restaurant_id = r.id;
    if not found then
      raise exception using errcode = 'GM004', message = 'item_not_found';
    end if;
    if not i.is_available or not exists (select 1 from public.categories c where c.id = i.category_id and c.restaurant_id = r.id and c.active) then
      raise exception using errcode = 'GM003', message = 'item_unavailable';
    end if;

    v := null;
    if exists (select 1 from public.item_variants iv where iv.item_id = i.id) then
      if l.variant_id is null then
        raise exception using errcode = 'GM015', message = 'invalid_input';   -- a size must be chosen
      end if;
      select * into v from public.item_variants iv where iv.id = l.variant_id and iv.item_id = i.id;
      if not found then
        raise exception using errcode = 'GM004', message = 'item_not_found';   -- that size was removed
      end if;
      if not v.is_available then
        raise exception using errcode = 'GM003', message = 'item_unavailable';
      end if;
      v_unit := v.price_paise;
    else
      if l.variant_id is not null then
        raise exception using errcode = 'GM015', message = 'invalid_input';
      end if;
      v_unit := i.price_paise;
    end if;

    v_delta := 0;
    v_opt_names := null;
    if cardinality(l.option_ids) > 0 then
      select count(*), coalesce(sum(io.price_delta_paise), 0),
             string_agg(io.name, ', ' order by ig.sort_order, io.sort_order, io.name)
        into v_n, v_delta, v_opt_names
        from public.item_options io join public.item_option_groups ig on ig.id = io.group_id
       where io.id = any (l.option_ids) and ig.item_id = i.id and ig.restaurant_id = r.id;
      if v_n <> cardinality(l.option_ids) then
        raise exception using errcode = 'GM004', message = 'item_not_found';   -- an option was removed
      end if;
      if exists (select 1 from public.item_option_groups ig
                  where ig.item_id = i.id
                    and (select count(*) from public.item_options io where io.group_id = ig.id and io.id = any (l.option_ids)) > ig.max_select) then
        raise exception using errcode = 'GM015', message = 'invalid_input';
      end if;
    end if;
    if exists (select 1 from public.item_option_groups ig
                where ig.item_id = i.id and ig.required
                  and not exists (select 1 from public.item_options io where io.group_id = ig.id and io.id = any (l.option_ids))) then
      raise exception using errcode = 'GM015', message = 'invalid_input';       -- a required choice is missing
    end if;

    v_unit := v_unit + v_delta;
    v_name := left(i.name_en || case when v.id is not null then ' (' || v.name || ')' else '' end
                   || case when v_opt_names is not null then ' + ' || v_opt_names else '' end, 200);
    v_total := v_total + v_unit * l.qty;
    v_calc := v_calc || jsonb_build_object('item_id', i.id, 'name', v_name, 'name_hi', i.name_hi, 'unit', v_unit, 'qty', l.qty,
                                           'note', nullif(btrim(coalesce(l.note, '')), ''));
  end loop;
  if v_total > c_max_total then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;

  update public.restaurants set order_counter = order_counter + 1 where id = r.id returning order_counter into v_order_no;

  insert into public.orders (restaurant_id, session_id, table_id, order_no, note, total_paise, idempotency_key)
  values (r.id, s.id, t.id, v_order_no, v_note, v_total, p_idem)
  returning * into o;

  insert into public.order_items (order_id, restaurant_id, item_id, name_en_snapshot, name_hi_snapshot, unit_price_paise, qty, note)
  select o.id, r.id, (c.j->>'item_id')::uuid, c.j->>'name', c.j->>'name_hi', (c.j->>'unit')::int, (c.j->>'qty')::int, c.j->>'note'
    from jsonb_array_elements(v_calc) with ordinality c(j, ord)
   order by c.ord;

  return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'total_paise', o.total_paise,
    'session_id', s.id, 'table_label', t.label, 'status', o.status, 'replayed', false);
end $$;

-- ---------- owner / manager: the dish editor ----------
create or replace function public.mgr_get_menu() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return jsonb_build_object('categories', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'name', c.name_en, 'active', c.active, 'sort_order', c.sort_order,
      'items', coalesce((select jsonb_agg(jsonb_build_object(
          'id', i.id, 'name', i.name_en, 'description', i.description_en, 'price_paise', i.price_paise, 'diet', i.diet,
          'spice', i.spice, 'image_path', i.image_path, 'is_available', i.is_available, 'is_bestseller', i.is_bestseller,
          'is_chef_pick', i.is_chef_pick, 'sort_order', i.sort_order,
          'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'price_paise', v.price_paise, 'is_available', v.is_available)
                                order by v.sort_order, v.price_paise)
                                  from public.item_variants v where v.item_id = i.id), '[]'::jsonb),
          'groups', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name, 'required', g.required, 'max_select', g.max_select,
                                'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'price_delta_paise', o.price_delta_paise)
                                                      order by o.sort_order, o.name)
                                                        from public.item_options o where o.group_id = g.id), '[]'::jsonb))
                              order by g.sort_order, g.name)
                                from public.item_option_groups g where g.item_id = i.id), '[]'::jsonb))
          order by i.sort_order, i.name_en)
        from public.items i where i.category_id = c.id and i.restaurant_id = v_rid), '[]'::jsonb))
      order by c.sort_order, c.name_en)
    from public.categories c where c.restaurant_id = v_rid), '[]'::jsonb));
end $$;

-- Replace a dish's sizes and options in one go. Rows with an id are updated, rows without are created, rows left out are
-- removed (past orders keep their own readable snapshot, so nothing in order history changes).
--   p_variants: [{id?, name, price_paise, is_available?}]            at most 8
--   p_groups:   [{id?, name, required, max_select, options:[{id?, name, price_delta_paise}]}]   at most 6 groups, 20 options each
create or replace function public.mgr_save_item_choices(p_item_id uuid, p_variants jsonb, p_groups jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner','manager']);
  v_variants jsonb := coalesce(p_variants, '[]'::jsonb);
  v_groups jsonb := coalesce(p_groups, '[]'::jsonb);
  e record; o record;
  v_id uuid; v_gid uuid; v_name text; v_price numeric; v_max numeric; v_ids uuid[];
begin
  if not exists (select 1 from public.items where id = p_item_id and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if jsonb_typeof(v_variants) <> 'array' or jsonb_typeof(v_groups) <> 'array'
     or jsonb_array_length(v_variants) > 8 or jsonb_array_length(v_groups) > 6 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  -- validate everything first
  for e in select x.value j from jsonb_array_elements(v_variants) x loop
    v_name := btrim(coalesce(e.j->>'name', ''));
    begin v_price := (e.j->>'price_paise')::numeric; exception when others then v_price := null; end;
    if jsonb_typeof(e.j) <> 'object' or char_length(v_name) not between 1 and 30
       or v_price is null or v_price <> trunc(v_price) or v_price not between 0 and 10000000 then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
  end loop;
  if (select count(distinct lower(btrim(x.value->>'name'))) from jsonb_array_elements(v_variants) x) <> jsonb_array_length(v_variants) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  for e in select x.value j from jsonb_array_elements(v_groups) x loop
    v_name := btrim(coalesce(e.j->>'name', ''));
    begin v_max := (e.j->>'max_select')::numeric; exception when others then v_max := null; end;
    if jsonb_typeof(e.j) <> 'object' or char_length(v_name) not between 1 and 40
       or v_max is null or v_max <> trunc(v_max) or v_max not between 1 and 20
       or jsonb_typeof(e.j->'options') is distinct from 'array'
       or jsonb_typeof(e.j->'required') is distinct from 'boolean' then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
    if jsonb_array_length(e.j->'options') not between 1 and 20 or v_max > jsonb_array_length(e.j->'options') then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
    for o in select y.value j from jsonb_array_elements(e.j->'options') y loop
      begin v_price := coalesce((o.j->>'price_delta_paise')::numeric, 0); exception when others then v_price := null; end;
      if jsonb_typeof(o.j) <> 'object' or char_length(btrim(coalesce(o.j->>'name', ''))) not between 1 and 40
         or v_price is null or v_price <> trunc(v_price) or v_price not between 0 and 5000000 then
        raise exception using errcode = 'GM015', message = 'invalid_input';
      end if;
    end loop;
  end loop;
  if (select count(distinct lower(btrim(x.value->>'name'))) from jsonb_array_elements(v_groups) x) <> jsonb_array_length(v_groups) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  -- sizes
  select coalesce(array_agg((x.value->>'id')::uuid), '{}') into v_ids from jsonb_array_elements(v_variants) x where nullif(x.value->>'id', '') is not null;
  delete from public.item_variants where item_id = p_item_id and restaurant_id = v_rid and id <> all (v_ids);
  -- names are unique per dish: park the kept rows under temporary names first so a swap (A<->B) cannot collide
  update public.item_variants set name = '~' || substr(md5(id::text), 1, 12) where item_id = p_item_id and restaurant_id = v_rid;
  for e in select x.value j, x.ordinality n from jsonb_array_elements(v_variants) with ordinality x loop
    v_id := nullif(e.j->>'id', '')::uuid;
    if v_id is not null then
      update public.item_variants
         set name = btrim(e.j->>'name'), price_paise = (e.j->>'price_paise')::int,
             is_available = coalesce((e.j->>'is_available')::boolean, true), sort_order = e.n
       where id = v_id and item_id = p_item_id and restaurant_id = v_rid;
      if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
    else
      insert into public.item_variants (restaurant_id, item_id, name, price_paise, is_available, sort_order)
      values (v_rid, p_item_id, btrim(e.j->>'name'), (e.j->>'price_paise')::int, coalesce((e.j->>'is_available')::boolean, true), e.n);
    end if;
  end loop;
  update public.items set price_paise = price_paise where id = p_item_id;   -- the trigger sets the cheapest size

  -- options
  select coalesce(array_agg((x.value->>'id')::uuid), '{}') into v_ids from jsonb_array_elements(v_groups) x where nullif(x.value->>'id', '') is not null;
  delete from public.item_option_groups where item_id = p_item_id and restaurant_id = v_rid and id <> all (v_ids);
  for e in select x.value j, x.ordinality n from jsonb_array_elements(v_groups) with ordinality x loop
    v_gid := nullif(e.j->>'id', '')::uuid;
    if v_gid is not null then
      update public.item_option_groups
         set name = btrim(e.j->>'name'), required = (e.j->>'required')::boolean, max_select = (e.j->>'max_select')::int, sort_order = e.n
       where id = v_gid and item_id = p_item_id and restaurant_id = v_rid;
      if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
    else
      insert into public.item_option_groups (restaurant_id, item_id, name, required, max_select, sort_order)
      values (v_rid, p_item_id, btrim(e.j->>'name'), (e.j->>'required')::boolean, (e.j->>'max_select')::int, e.n)
      returning id into v_gid;
    end if;
    select coalesce(array_agg((y.value->>'id')::uuid), '{}') into v_ids from jsonb_array_elements(e.j->'options') y where nullif(y.value->>'id', '') is not null;
    delete from public.item_options where group_id = v_gid and restaurant_id = v_rid and id <> all (v_ids);
    for o in select y.value j, y.ordinality n from jsonb_array_elements(e.j->'options') with ordinality y loop
      v_id := nullif(o.j->>'id', '')::uuid;
      if v_id is not null then
        update public.item_options
           set name = btrim(o.j->>'name'), price_delta_paise = coalesce((o.j->>'price_delta_paise')::int, 0), sort_order = o.n
         where id = v_id and group_id = v_gid and restaurant_id = v_rid;
        if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
      else
        insert into public.item_options (restaurant_id, group_id, name, price_delta_paise, sort_order)
        values (v_rid, v_gid, btrim(o.j->>'name'), coalesce((o.j->>'price_delta_paise')::int, 0), o.n);
      end if;
    end loop;
  end loop;

  perform private.write_audit(v_rid, 'item_choices_saved', 'items', p_item_id::text,
    jsonb_build_object('sizes', jsonb_array_length(v_variants), 'option_groups', jsonb_array_length(v_groups)));
end $$;

-- a copy of a dish keeps its sizes and options
create or replace function public.mgr_duplicate_item(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); i public.items; v_name text; n int := 1; v_new uuid; g record; v_g uuid;
begin
  select * into i from public.items where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  v_name := left(i.name_en, 71) || ' (copy)';
  while exists (select 1 from public.items where category_id = i.category_id and lower(name_en) = lower(v_name)) loop
    n := n + 1;
    v_name := left(i.name_en, 68) || ' (copy ' || n || ')';
  end loop;
  insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice, image_path,
                            is_bestseller, is_chef_pick, is_available, sort_order)
  values (v_rid, i.category_id, v_name, i.description_en, i.price_paise, i.diet, i.spice, i.image_path, i.is_bestseller,
          i.is_chef_pick, i.is_available, coalesce((select max(sort_order) + 1 from public.items where category_id = i.category_id), 0))
  returning id into v_new;
  insert into public.item_variants (restaurant_id, item_id, name, price_paise, is_available, sort_order)
    select restaurant_id, v_new, name, price_paise, is_available, sort_order from public.item_variants where item_id = p_id;
  for g in select * from public.item_option_groups where item_id = p_id order by sort_order loop
    insert into public.item_option_groups (restaurant_id, item_id, name, required, max_select, sort_order)
    values (v_rid, v_new, g.name, g.required, g.max_select, g.sort_order) returning id into v_g;
    insert into public.item_options (restaurant_id, group_id, name, price_delta_paise, sort_order)
      select restaurant_id, v_g, name, price_delta_paise, sort_order from public.item_options where group_id = g.id;
  end loop;
  return v_new;
end $$;

-- Bulk price change also moves every size price (add Rs 10 to all selected dishes = Rs 10 on each size).
create or replace function public.mgr_bulk_price(p_item_ids uuid[], p_mode text, p_value numeric) returns int
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); n int;
begin
  if p_item_ids is null or cardinality(p_item_ids) not between 1 and 300 or p_mode not in ('percent','add','set') or p_value is null
     or abs(p_value) > 100000000 or (p_mode = 'percent' and p_value < -100) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.items where restaurant_id = v_rid and id = any (p_item_ids)) <> (select count(distinct x) from unnest(p_item_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (
       select 1 from public.items i where i.restaurant_id = v_rid and i.id = any (p_item_ids)
          and (case p_mode when 'percent' then round(i.price_paise * (1 + p_value / 100.0)) when 'add' then i.price_paise + p_value else p_value end)
              not between 0 and 10000000)
     or exists (
       select 1 from public.item_variants v where v.restaurant_id = v_rid and v.item_id = any (p_item_ids)
          and (case p_mode when 'percent' then round(v.price_paise * (1 + p_value / 100.0)) when 'add' then v.price_paise + p_value else p_value end)
              not between 0 and 10000000) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.item_variants v set price_paise = (case p_mode when 'percent' then round(v.price_paise * (1 + p_value / 100.0)) when 'add' then v.price_paise + p_value else p_value end)::int
   where v.restaurant_id = v_rid and v.item_id = any (p_item_ids);
  update public.items i set price_paise = (case p_mode when 'percent' then round(i.price_paise * (1 + p_value / 100.0)) when 'add' then i.price_paise + p_value else p_value end)::int
   where i.restaurant_id = v_rid and i.id = any (p_item_ids);   -- the trigger keeps dishes with sizes at their cheapest size
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.mgr_get_menu(), public.mgr_save_item_choices(uuid, jsonb, jsonb), public.mgr_duplicate_item(uuid),
  public.mgr_bulk_price(uuid[], text, numeric) from public, anon, service_role;
grant execute on function public.mgr_get_menu(), public.mgr_save_item_choices(uuid, jsonb, jsonb), public.mgr_duplicate_item(uuid),
  public.mgr_bulk_price(uuid[], text, numeric) to authenticated;

-- CSV import: an optional `sizes` list per dish ({name, price_paise}); see src/lib/dash/csv.ts
create or replace function public.mgr_import_items(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner','manager']);
  r record; v_errors jsonb := '[]'::jsonb; v_created int := 0; v_updated int := 0; v_cats int := 0;
  v_cat uuid; v_exists uuid; v_seen text[] := '{}'; v_key text; v_price numeric; v_item uuid; sz record;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  for r in select e.value as j, e.ordinality as n from jsonb_array_elements(p_rows) with ordinality e loop
    begin
      v_price := (r.j->>'price_paise')::numeric;
      v_key := lower(btrim(r.j->>'category')) || '|' || lower(btrim(r.j->>'name'));
      if char_length(btrim(coalesce(r.j->>'category', ''))) not between 1 and 60 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Category must be 1 to 60 characters');
      elsif char_length(btrim(coalesce(r.j->>'name', ''))) not between 1 and 80 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Name must be 1 to 80 characters');
      elsif v_price is null or v_price <> trunc(v_price) or v_price not between 0 and 10000000 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Price must be between 0 and 1,00,000 rupees');
      elsif coalesce(r.j->>'diet', '') not in ('veg','nonveg','egg','jain') then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Diet must be veg, nonveg, egg or jain');
      elsif coalesce((r.j->>'spice')::int, -1) not between 0 and 3 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Spice must be 0, 1, 2 or 3');
      elsif char_length(coalesce(r.j->>'description', '')) > 300 then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Description is longer than 300 characters');
      elsif r.j ? 'sizes' and (
              jsonb_typeof(r.j->'sizes') <> 'array' or jsonb_array_length(r.j->'sizes') > 8
              or exists (select 1 from jsonb_array_elements(r.j->'sizes') z
                          where char_length(btrim(coalesce(z.value->>'name', ''))) not between 1 and 30
                             or (z.value->>'price_paise') is null
                             or (z.value->>'price_paise')::numeric not between 0 and 10000000
                             or (z.value->>'price_paise')::numeric <> trunc((z.value->>'price_paise')::numeric))
              or (select count(distinct lower(btrim(z.value->>'name'))) from jsonb_array_elements(r.j->'sizes') z) <> jsonb_array_length(r.j->'sizes')) then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'Sizes: up to 8, each like Small:120, with no name repeated');
      elsif v_key = any (v_seen) then
        v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'This dish appears twice in the file');
      end if;
      v_seen := v_seen || v_key;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', r.n, 'message', 'This row could not be read');
    end;
  end loop;
  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object('ok', false, 'errors', v_errors);
  end if;

  for r in select e.value as j from jsonb_array_elements(p_rows) with ordinality e order by e.ordinality loop
    select id into v_cat from public.categories where restaurant_id = v_rid and lower(name_en) = lower(btrim(r.j->>'category'));
    if v_cat is null then
      insert into public.categories (restaurant_id, name_en, sort_order)
      values (v_rid, btrim(r.j->>'category'), coalesce((select max(sort_order) + 1 from public.categories where restaurant_id = v_rid), 0))
      returning id into v_cat;
      v_cats := v_cats + 1;
    end if;
    select id into v_exists from public.items where category_id = v_cat and lower(name_en) = lower(btrim(r.j->>'name'));
    if v_exists is null then
      insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice, is_bestseller,
                                is_chef_pick, is_available, sort_order)
      values (v_rid, v_cat, btrim(r.j->>'name'), nullif(btrim(coalesce(r.j->>'description', '')), ''), (r.j->>'price_paise')::int,
              r.j->>'diet', (r.j->>'spice')::int, coalesce((r.j->>'bestseller')::boolean, false), coalesce((r.j->>'chef_pick')::boolean, false),
              coalesce((r.j->>'available')::boolean, true),
              coalesce((select max(sort_order) + 1 from public.items where category_id = v_cat), 0));
      v_created := v_created + 1;
    else
      update public.items set description_en = nullif(btrim(coalesce(r.j->>'description', '')), ''), price_paise = (r.j->>'price_paise')::int,
             diet = r.j->>'diet', spice = (r.j->>'spice')::int, is_bestseller = coalesce((r.j->>'bestseller')::boolean, false),
             is_chef_pick = coalesce((r.j->>'chef_pick')::boolean, false), is_available = coalesce((r.j->>'available')::boolean, true)
       where id = v_exists;
      v_updated := v_updated + 1;
    end if;
    -- sizes in the file replace the dish's sizes (matched by name, so prices update in place); a file without sizes leaves them alone
    if r.j ? 'sizes' and jsonb_array_length(r.j->'sizes') > 0 then
      select id into v_item from public.items where category_id = v_cat and lower(name_en) = lower(btrim(r.j->>'name'));
      delete from public.item_variants where item_id = v_item
         and lower(name) <> all (select lower(btrim(z.value->>'name')) from jsonb_array_elements(r.j->'sizes') z);
      for sz in select e.value as j, e.ordinality as n from jsonb_array_elements(r.j->'sizes') with ordinality e loop
        insert into public.item_variants (restaurant_id, item_id, name, price_paise, sort_order)
        values (v_rid, v_item, btrim(sz.j->>'name'), (sz.j->>'price_paise')::int, sz.n)
        on conflict (item_id, lower(name)) do update set price_paise = excluded.price_paise, sort_order = excluded.sort_order;
      end loop;
      update public.items set price_paise = price_paise where id = v_item;
    end if;
  end loop;
  perform private.write_audit(v_rid, 'menu_import', 'items', null, jsonb_build_object('created', v_created, 'updated', v_updated, 'categories_created', v_cats));
  return jsonb_build_object('ok', true, 'created', v_created, 'updated', v_updated, 'categories_created', v_cats);
end $$;


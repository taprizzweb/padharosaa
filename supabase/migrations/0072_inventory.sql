-- 0072_inventory
-- Stock of the hotel's kitchen and housekeeping supplies: items with a unit and a low-stock level, and a ledger of every movement
-- (stock in with its cost, stock used, wasted, or a counted correction). Stock is the sum of the ledger; it never goes below zero.
-- RLS is on with no policy: the app reaches the data only through the functions below. Idempotent.
-- Rollback: drop the functions, then inventory_moves, then inventory_items.
create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  unit          text not null check (char_length(unit) between 1 and 12),
  category      text check (category is null or char_length(category) <= 40),
  min_qty       numeric(12,3) not null default 0 check (min_qty between 0 and 1000000),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, name),
  unique (id, restaurant_id)
);
alter table public.inventory_items enable row level security;

create table if not exists public.inventory_moves (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  item_id       uuid not null,
  kind          text not null check (kind in ('in','out','waste','adjust')),
  delta         numeric(12,3) not null check (delta <> 0 and delta between -1000000 and 1000000),
  cost_paise    int check (cost_paise is null or cost_paise between 0 and 100000000),
  note          text check (note is null or char_length(note) <= 120),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint inventory_moves_item_fk foreign key (item_id, restaurant_id) references public.inventory_items (id, restaurant_id) on delete cascade
);
create index if not exists inventory_moves_item_idx on public.inventory_moves (item_id, created_at desc);
alter table public.inventory_moves enable row level security;

create or replace function private.inv_staff() returns uuid
language plpgsql security definer set search_path = '' as $$
begin return private.require_hotel_staff(array['owner','manager','kitchen','waiter']); end $$;
revoke all on function private.inv_staff() from public, anon;
grant execute on function private.inv_staff() to authenticated;

create or replace function public.padh_inv_item_save(p_id uuid, p_name text, p_unit text, p_category text, p_min numeric, p_active boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_name text := private.bill_text(p_name); v_unit text := private.bill_text(p_unit); v_cat text := private.bill_text(p_category); v_id uuid;
begin
  if v_name is null or char_length(v_name) > 60 or v_unit is null or char_length(v_unit) > 12 or (v_cat is not null and char_length(v_cat) > 40)
     or p_min is null or p_min < 0 or p_min > 1000000 or p_active is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if exists (select 1 from public.inventory_items where restaurant_id = v_rid and lower(name) = lower(v_name) and id is distinct from p_id) then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  if p_id is null then
    if (select count(*) from public.inventory_items where restaurant_id = v_rid) >= 500 then raise exception using errcode = 'GM006', message = 'limit_exceeded'; end if;
    insert into public.inventory_items (restaurant_id, name, unit, category, min_qty, active) values (v_rid, v_name, v_unit, v_cat, p_min, p_active) returning id into v_id;
  else
    update public.inventory_items set name = v_name, unit = v_unit, category = v_cat, min_qty = p_min, active = p_active where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  perform private.write_audit(v_rid, 'padh_inv_item_save', 'inventory_items', v_id::text, jsonb_build_object('name', v_name));
  return jsonb_build_object('id', v_id);
end $$;
revoke all on function public.padh_inv_item_save(uuid, text, text, text, numeric, boolean) from public, anon, service_role;
grant execute on function public.padh_inv_item_save(uuid, text, text, text, numeric, boolean) to authenticated;

-- p_kind 'in' (bought or received, with the total cost), 'out' (used), 'waste' (spoiled, broken), 'adjust' (a count: p_qty is what is on the shelf now)
create or replace function public.padh_inv_move(p_item uuid, p_kind text, p_qty numeric, p_cost_paise int, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.inv_staff(); v_note text := private.bill_text(p_note); v_stock numeric; v_delta numeric; it public.inventory_items;
begin
  if p_kind is null or p_kind not in ('in','out','waste','adjust') or p_qty is null or p_qty > 1000000 or (p_kind <> 'adjust' and p_qty <= 0) or (p_kind = 'adjust' and p_qty < 0)
     or (p_cost_paise is not null and (p_cost_paise < 0 or p_cost_paise > 100000000 or p_kind <> 'in')) or (v_note is not null and char_length(v_note) > 120) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_qty <> round(p_qty, 3) then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  if not private.rl_hit('padh_inv_move:' || v_rid::text || ':' || auth.uid()::text, 300, 3600) then raise exception using errcode = 'GM007', message = 'rate_limited'; end if;
  select * into it from public.inventory_items where id = p_item and restaurant_id = v_rid and active for update;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  select coalesce(sum(delta), 0) into v_stock from public.inventory_moves where item_id = p_item;
  v_delta := case p_kind when 'in' then p_qty when 'adjust' then p_qty - v_stock else -p_qty end;
  if v_delta = 0 then return jsonb_build_object('stock', v_stock); end if;
  if v_stock + v_delta < 0 then raise exception using errcode = 'GM019', message = 'conflict'; end if;
  -- the kitchen and reception record use and waste; buying and counting are for the owner and manager
  if p_kind in ('in','adjust') and not exists (select 1 from public.staff where user_id = auth.uid() and restaurant_id = v_rid and active and role in ('owner','manager')) then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  insert into public.inventory_moves (restaurant_id, item_id, kind, delta, cost_paise, note, created_by) values (v_rid, p_item, p_kind, v_delta, p_cost_paise, v_note, auth.uid());
  perform private.write_audit(v_rid, 'padh_inv_move', 'inventory_items', p_item::text, jsonb_build_object('kind', p_kind, 'delta', v_delta));
  return jsonb_build_object('stock', v_stock + v_delta);
end $$;
revoke all on function public.padh_inv_move(uuid, text, numeric, int, text) from public, anon, service_role;
grant execute on function public.padh_inv_move(uuid, text, numeric, int, text) to authenticated;

create or replace function public.padh_inv_list() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.inv_staff();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.low desc, x.name) from (
    select i.id, i.name, i.unit, i.category, i.min_qty, i.active, coalesce(m.stock, 0) as stock, (i.active and coalesce(m.stock, 0) <= i.min_qty and i.min_qty > 0) as low,
           m.last_at, coalesce(m.used_30, 0) as used_30, coalesce(m.spent_30, 0) as spent_30
      from public.inventory_items i
      left join lateral (select sum(delta) as stock, max(created_at) as last_at,
                                -sum(delta) filter (where kind in ('out','waste') and created_at > now() - interval '30 days') as used_30,
                                sum(cost_paise) filter (where kind = 'in' and created_at > now() - interval '30 days') as spent_30
                           from public.inventory_moves where item_id = i.id) m on true
     where i.restaurant_id = v_rid) x), '[]'::jsonb);
end $$;
revoke all on function public.padh_inv_list() from public, anon, service_role;
grant execute on function public.padh_inv_list() to authenticated;

create or replace function public.padh_inv_moves(p_item uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.inv_staff();
begin
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.at desc) from (
    select m.id, m.kind, m.delta, m.cost_paise, m.note, m.created_at as at, s.display_name as by
      from public.inventory_moves m left join public.staff s on s.user_id = m.created_by and s.restaurant_id = m.restaurant_id
     where m.item_id = p_item and m.restaurant_id = v_rid order by m.created_at desc limit 40) x), '[]'::jsonb);
end $$;
revoke all on function public.padh_inv_moves(uuid) from public, anon, service_role;
grant execute on function public.padh_inv_moves(uuid) to authenticated;

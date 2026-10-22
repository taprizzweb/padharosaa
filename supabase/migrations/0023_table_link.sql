-- 0023: a shared TABLE link (the guest picks a table number), next to the per-table QR codes and the room-service link.
-- Three ways to order, the owner uses whichever fit: (1) each table's own QR (0002), (2) one shared table link (this file),
-- (3) one shared room link (0022). Table picking only ever opens real tables the owner created (kind 'table'); room picking
-- only ever opens rooms (kind 'room'), so neither link can show or reach the other kind.
-- Like the room link, the shared token can only OPEN a table; it cannot place an order itself.
-- Idempotent. Rollback: drop guest_open_table / mgr_get_table_link / mgr_set_table_link and the table_token column;
-- restore guest_get_menu from 0022.

alter table public.restaurants add column if not exists table_token text;
do $$ begin
  alter table public.restaurants add constraint restaurants_table_token_format check (table_token is null or table_token ~ '^[0-9a-f]{64}$');
exception when duplicate_object then null;
end $$;
create unique index if not exists restaurants_table_token_uq on public.restaurants (table_token) where table_token is not null;

create or replace function public.mgr_get_table_link() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); r public.restaurants;
begin
  select * into r from public.restaurants where id = v_rid;
  return jsonb_build_object('enabled', r.table_token is not null, 'token', r.table_token);
end $$;

-- p_enabled false switches the link off (token erased, old link stops); p_rotate makes a new token.
create or replace function public.mgr_set_table_link(p_enabled boolean, p_rotate boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']); r public.restaurants;
begin
  if p_enabled is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into r from public.restaurants where id = v_rid for update;
  update public.restaurants
     set table_token = case when not p_enabled then null
                            when r.table_token is null or coalesce(p_rotate, false)
                              then replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
                            else r.table_token end
   where id = v_rid;
  perform private.write_audit(v_rid, 'table_link_updated', 'restaurants', v_rid::text,
    jsonb_build_object('enabled', p_enabled, 'rotated', coalesce(p_rotate, false)));
end $$;
revoke all on function public.mgr_get_table_link(), public.mgr_set_table_link(boolean, boolean) from public, anon, service_role;
grant execute on function public.mgr_get_table_link(), public.mgr_set_table_link(boolean, boolean) to authenticated;

-- Service role only (called by /api/guest/table). The table must already exist (the owner created it) and be on.
create or replace function public.guest_open_table(p_slug text, p_token text, p_label text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_label text := btrim(coalesce(p_label, ''));
  t public.dining_tables;
begin
  if p_slug is null or p_token is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_ip_hash is not null and not private.rl_hit('tbl:' || p_ip_hash, 40, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;
  select * into r from public.restaurants where slug = p_slug and table_token = p_token;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  if char_length(v_label) not between 1 and 20 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into t from public.dining_tables
   where restaurant_id = r.id and kind = 'table' and active and lower(label) = lower(v_label);
  if not found then
    raise exception using errcode = 'GM022', message = 'unknown_room';  -- "that number is not on the list"
  end if;
  return jsonb_build_object('token', t.qr_token, 'label', t.label);
end $$;
revoke all on function public.guest_open_table(text, text, text, text) from public, anon, authenticated;
grant execute on function public.guest_open_table(text, text, text, text) to service_role;

-- guest menu: also tell the page when the link is the shared table link, with the table names to choose from
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
            'is_available', i.is_available, 'is_bestseller', i.is_bestseller, 'is_chef_pick', i.is_chef_pick)
            order by i.sort_order, i.name_en)
          from public.items i where i.category_id = c.id and i.restaurant_id = r.id), '[]'::jsonb))
        order by c.sort_order, c.name_en)
      from public.categories c where c.restaurant_id = r.id and c.active), '[]'::jsonb));
end $$;

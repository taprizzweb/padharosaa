-- 0013_dashboard_functions
-- Everything the owner/manager dashboard does, as role-checked SQL functions (menu, tables, settings, staff, report,
-- audit log). Writes need an ACTIVE restaurant; reads keep working while suspended. Staff accounts need Supabase Auth
-- (done by the server with the service key), so the staff-writing functions are service_role-only and take the
-- owner's id explicitly and re-verify it. Idempotent. Rollback: drop the functions and the two unique indexes.
--
-- New error codes: GM018 category_not_empty, GM019 conflict (name/label/email already used),
--                  GM020 protected (owners are managed by the platform admin, not by themselves).

-- ---------- uniqueness that makes "same name twice" a friendly error instead of a confusing duplicate ----------
create unique index if not exists categories_name_uq on public.categories (restaurant_id, lower(name_en));
create unique index if not exists items_name_uq on public.items (category_id, lower(name_en));

-- ---------- audit: attribute service-role actions to the owner who asked, and keep reordering out of the log ----------
create or replace function private.write_audit(p_restaurant uuid, p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := coalesce(auth.uid(), nullif(current_setting('gotomenu.actor', true), '')::uuid);
begin
  insert into public.audit_log (restaurant_id, actor_user_id, actor_role, action, entity, entity_id, details)
  values (p_restaurant, v_actor,
          coalesce((select s.role from public.staff s where s.user_id = v_actor),
                   case when exists (select 1 from public.platform_admins a where a.user_id = v_actor) then 'platform_admin' end),
          p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function private.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

create or replace function private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_skip text[] := array['qr_token','order_counter','sort_order'];
  v_row jsonb; v_old jsonb; v_diff jsonb; v_rid uuid; v_id text;
begin
  if coalesce(current_setting('gotomenu.audit_purge', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then v_row := to_jsonb(old) - v_skip; else v_row := to_jsonb(new) - v_skip; end if;
  v_diff := v_row;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old) - v_skip;
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into v_diff
      from jsonb_each(v_row) n join jsonb_each(v_old) o on o.key = n.key
      where n.value is distinct from o.value;
    if v_diff = '{}'::jsonb then return null; end if;
  end if;
  v_rid := coalesce((v_row->>'restaurant_id')::uuid, case when tg_table_name = 'restaurants' then (v_row->>'id')::uuid end);
  v_id  := coalesce(v_row->>'id', v_row->>'user_id');
  perform private.write_audit(v_rid, lower(tg_op), tg_table_name, v_id, v_diff);
  return null;
end $$;
revoke all on function private.audit_row() from public, anon, authenticated;

-- read access for owner/manager that does NOT require an active restaurant
create or replace function private.require_read(p_roles text[]) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null or not (v_role = any (p_roles)) then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return v_rid;
end $$;
revoke all on function private.require_read(text[]) from public, anon, authenticated;

-- ---------- menu: read ----------
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
          'is_chef_pick', i.is_chef_pick, 'sort_order', i.sort_order) order by i.sort_order, i.name_en)
        from public.items i where i.category_id = c.id and i.restaurant_id = v_rid), '[]'::jsonb))
      order by c.sort_order, c.name_en)
    from public.categories c where c.restaurant_id = v_rid), '[]'::jsonb));
end $$;

-- ---------- menu: categories ----------
create or replace function public.mgr_save_category(p_id uuid, p_name text, p_active boolean default true) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); v_name text := btrim(coalesce(p_name, '')); v_id uuid;
begin
  if char_length(v_name) not between 1 and 60 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from public.categories where restaurant_id = v_rid and lower(name_en) = lower(v_name) and id is distinct from p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  if p_id is null then
    insert into public.categories (restaurant_id, name_en, active, sort_order)
    values (v_rid, v_name, p_active, coalesce((select max(sort_order) + 1 from public.categories where restaurant_id = v_rid), 0))
    returning id into v_id;
  else
    update public.categories set name_en = v_name, active = p_active where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.mgr_delete_category(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  if not exists (select 1 from public.categories where id = p_id and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (select 1 from public.items where category_id = p_id) then
    raise exception using errcode = 'GM018', message = 'category_not_empty';
  end if;
  delete from public.categories where id = p_id and restaurant_id = v_rid;
end $$;

create or replace function public.mgr_reorder_categories(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 200 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.categories where restaurant_id = v_rid and id = any (p_ids)) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  update public.categories c set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality o(id, ord) where c.id = o.id and c.restaurant_id = v_rid;
end $$;

-- ---------- menu: items ----------
create or replace function public.mgr_save_item(
  p_id uuid, p_category uuid, p_name text, p_description text, p_price_paise int, p_diet text, p_spice int,
  p_image_path text, p_bestseller boolean, p_chef_pick boolean, p_available boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner','manager']);
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id uuid;
begin
  if char_length(v_name) not between 1 and 80 or (v_desc is not null and char_length(v_desc) > 300)
     or p_price_paise is null or p_price_paise not between 0 and 10000000
     or p_diet is null or p_diet not in ('veg','nonveg','egg','jain') or p_spice is null or p_spice not between 0 and 3
     or p_bestseller is null or p_chef_pick is null
     or (p_image_path is not null and (p_image_path not like v_rid::text || '/%' or p_image_path ~ '\.\.' or char_length(p_image_path) > 200)) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if not exists (select 1 from public.categories where id = p_category and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (select 1 from public.items where category_id = p_category and lower(name_en) = lower(v_name) and id is distinct from p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  if p_id is null then
    insert into public.items (restaurant_id, category_id, name_en, description_en, price_paise, diet, spice, image_path,
                              is_bestseller, is_chef_pick, is_available, sort_order)
    values (v_rid, p_category, v_name, v_desc, p_price_paise, p_diet, p_spice, p_image_path, p_bestseller, p_chef_pick,
            coalesce(p_available, true),
            coalesce((select max(sort_order) + 1 from public.items where category_id = p_category), 0))
    returning id into v_id;
  else
    update public.items set category_id = p_category, name_en = v_name, description_en = v_desc, price_paise = p_price_paise,
           diet = p_diet, spice = p_spice, image_path = p_image_path, is_bestseller = p_bestseller, is_chef_pick = p_chef_pick,
           is_available = coalesce(p_available, is_available)
     where id = p_id and restaurant_id = v_rid returning id into v_id;
    if v_id is null then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  end if;
  return v_id;
end $$;

create or replace function public.mgr_delete_item(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  delete from public.items where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
end $$;

create or replace function public.mgr_duplicate_item(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); i public.items; v_name text; n int := 1; v_new uuid;
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
  return v_new;
end $$;

create or replace function public.mgr_reorder_items(p_category uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']);
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 500 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if (select count(*) from public.items where restaurant_id = v_rid and category_id = p_category and id = any (p_ids)) <> (select count(distinct x) from unnest(p_ids) x) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  update public.items i set sort_order = o.ord - 1
    from unnest(p_ids) with ordinality o(id, ord) where i.id = o.id and i.restaurant_id = v_rid;
end $$;

-- p_mode: percent (+/- %), add (+/- paise), set (exact paise). Every result must stay within 0 .. Rs 1,00,000.
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
          not between 0 and 10000000) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.items i set price_paise = (case p_mode when 'percent' then round(i.price_paise * (1 + p_value / 100.0)) when 'add' then i.price_paise + p_value else p_value end)::int
   where i.restaurant_id = v_rid and i.id = any (p_item_ids);
  get diagnostics n = row_count;
  return n;
end $$;

-- CSV import: all-or-nothing. Returns {ok:false, errors:[{row,message}]} without touching anything if any row is invalid.
create or replace function public.mgr_import_items(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner','manager']);
  r record; v_errors jsonb := '[]'::jsonb; v_created int := 0; v_updated int := 0; v_cats int := 0;
  v_cat uuid; v_exists uuid; v_seen text[] := '{}'; v_key text; v_price numeric;
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
  end loop;
  perform private.write_audit(v_rid, 'menu_import', 'items', null, jsonb_build_object('created', v_created, 'updated', v_updated, 'categories_created', v_cats));
  return jsonb_build_object('ok', true, 'created', v_created, 'updated', v_updated, 'categories_created', v_cats);
end $$;

-- ---------- tables ----------
create or replace function public.mgr_save_table(p_id uuid, p_label text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); v_label text := btrim(coalesce(p_label, ''));
begin
  if char_length(v_label) not between 1 and 20 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from public.dining_tables where restaurant_id = v_rid and label = v_label and id <> p_id) then
    raise exception using errcode = 'GM019', message = 'conflict';
  end if;
  update public.dining_tables set label = v_label, active = p_active where id = p_id and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
end $$;

-- ---------- settings ----------
create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role())
          from public.restaurants r where r.id = v_rid);
end $$;

create or replace function public.mgr_update_settings(p_name text, p_review_url text, p_accent text, p_amber int, p_red int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']); v_name text := btrim(coalesce(p_name, '')); v_url text := nullif(btrim(coalesce(p_review_url, '')), '');
begin
  if char_length(v_name) not between 1 and 80
     or (v_url is not null and (v_url !~ '^https://[^[:space:]]+$' or char_length(v_url) > 500))
     or p_accent is null or p_accent not in ('saffron','tomato','emerald','teal','indigo','plum','rose','slate')
     or p_amber is null or p_red is null or p_amber not between 1 and 120 or p_red not between 2 and 240 or p_red <= p_amber then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  update public.restaurants set name = v_name, review_url = v_url, accent = p_accent, amber_minutes = p_amber, red_minutes = p_red where id = v_rid;
end $$;

-- ---------- staff accounts ----------
create or replace function public.mgr_get_staff() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'email', u.email, 'display_name', s.display_name,
                    'role', s.role, 'active', s.active, 'created_at', s.created_at, 'is_you', s.user_id = auth.uid())
                    order by case s.role when 'owner' then 0 when 'manager' then 1 when 'waiter' then 2 else 3 end, s.display_name)
                   from public.staff s join auth.users u on u.id = s.user_id where s.restaurant_id = v_rid), '[]'::jsonb);
end $$;

-- service_role only: the server has just created the Auth user; p_owner is the signed-in owner asking for it.
create or replace function private.require_owner_of(p_owner uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid; v_status text;
begin
  select s.restaurant_id, r.status into v_rid, v_status from public.staff s join public.restaurants r on r.id = s.restaurant_id
   where s.user_id = p_owner and s.role = 'owner' and s.active;
  if v_rid is null then raise exception using errcode = 'GM011', message = 'forbidden'; end if;
  if v_status <> 'active' then raise exception using errcode = 'GM001', message = 'restaurant_suspended'; end if;
  return v_rid;
end $$;
revoke all on function private.require_owner_of(uuid) from public, anon, authenticated;

create or replace function public.owner_add_staff(p_owner uuid, p_user uuid, p_role text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_owner_of(p_owner); v_name text := btrim(coalesce(p_name, ''));
begin
  if p_role not in ('manager','waiter','kitchen') or char_length(v_name) not between 1 and 60 or p_user is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  perform set_config('gotomenu.actor', p_owner::text, true);
  insert into public.staff (user_id, restaurant_id, role, display_name) values (p_user, v_rid, p_role, v_name);
  return p_user;
exception when unique_violation then
  raise exception using errcode = 'GM019', message = 'conflict';
end $$;

create or replace function public.owner_set_staff(p_owner uuid, p_user uuid, p_role text, p_name text, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_owner_of(p_owner); t public.staff; v_name text := btrim(coalesce(p_name, ''));
begin
  if p_role not in ('manager','waiter','kitchen') or char_length(v_name) not between 1 and 60 or p_active is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into t from public.staff where user_id = p_user and restaurant_id = v_rid;
  if not found then raise exception using errcode = 'GM012', message = 'not_found'; end if;
  if t.role = 'owner' then raise exception using errcode = 'GM020', message = 'protected'; end if;
  perform set_config('gotomenu.actor', p_owner::text, true);
  update public.staff set role = p_role, display_name = v_name, active = p_active where user_id = p_user;
end $$;

-- used before a password reset: the target must be a non-owner member of the caller's restaurant
create or replace function public.owner_check_staff(p_owner uuid, p_user uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_owner_of(p_owner);
begin
  if not exists (select 1 from public.staff where user_id = p_user and restaurant_id = v_rid) then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if exists (select 1 from public.staff where user_id = p_user and role = 'owner') then
    raise exception using errcode = 'GM020', message = 'protected';
  end if;
  perform set_config('gotomenu.actor', p_owner::text, true);
  perform private.write_audit(v_rid, 'staff_password_reset', 'staff', p_user::text, '{}'::jsonb);
  return true;
end $$;

-- ---------- report (days are Indian days: Asia/Kolkata) ----------
create or replace function public.mgr_report(p_range text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_read(array['owner','manager']);
  v_days int := case p_range when 'today' then 1 when '7d' then 7 when '30d' then 30 end;
  v_from timestamptz; v_orders int; v_revenue bigint; v_cancelled int;
begin
  if v_days is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  v_from := (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => v_days - 1)) at time zone 'Asia/Kolkata';
  select count(*) filter (where status <> 'cancelled'), coalesce(sum(total_paise) filter (where status <> 'cancelled'), 0), count(*) filter (where status = 'cancelled')
    into v_orders, v_revenue, v_cancelled from public.orders where restaurant_id = v_rid and created_at >= v_from;
  return jsonb_build_object(
    'range', p_range, 'from', v_from,
    'orders', v_orders, 'cancelled', v_cancelled, 'revenue_paise', v_revenue,
    'average_order_paise', case when v_orders = 0 then 0 else round(v_revenue::numeric / v_orders) end,
    'review_taps', (select count(*) from public.review_clicks where restaurant_id = v_rid and created_at >= v_from),
    'top_dishes', coalesce((select jsonb_agg(t) from (
        select oi.name_en_snapshot as name, sum(oi.qty)::int as qty, sum(oi.qty::bigint * oi.unit_price_paise) as revenue_paise
          from public.order_items oi join public.orders o on o.id = oi.order_id
         where oi.restaurant_id = v_rid and o.created_at >= v_from and o.status <> 'cancelled'
         group by oi.name_en_snapshot order by sum(oi.qty) desc, oi.name_en_snapshot limit 10) t), '[]'::jsonb),
    'peak_hours', coalesce((select jsonb_agg(jsonb_build_object('hour', h, 'orders', coalesce(c.n, 0)) order by h)
        from generate_series(0, 23) h left join (
          select extract(hour from created_at at time zone 'Asia/Kolkata')::int as hr, count(*)::int as n
            from public.orders where restaurant_id = v_rid and created_at >= v_from and status <> 'cancelled' group by 1) c on c.hr = h), '[]'::jsonb));
end $$;

-- ---------- audit log viewer ----------
create or replace function public.mgr_get_audit(p_limit int default 100, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return coalesce((select jsonb_agg(t order by t.id desc) from (
    select a.id, a.created_at, a.action, a.entity, a.entity_id, a.details, a.actor_role,
           case when a.actor_role = 'platform_admin' then 'Platform admin' else coalesce(s.display_name, 'System') end as actor_name
      from public.audit_log a left join public.staff s on s.user_id = a.actor_user_id
     where a.restaurant_id = v_rid and (p_before is null or a.id < p_before)
     order by a.id desc limit least(greatest(coalesce(p_limit, 100), 1), 200)) t), '[]'::jsonb);
end $$;

-- ---------- grants ----------
revoke all on function public.mgr_get_menu(), public.mgr_save_category(uuid, text, boolean), public.mgr_delete_category(uuid),
  public.mgr_reorder_categories(uuid[]),
  public.mgr_save_item(uuid, uuid, text, text, int, text, int, text, boolean, boolean, boolean), public.mgr_delete_item(uuid),
  public.mgr_duplicate_item(uuid), public.mgr_reorder_items(uuid, uuid[]), public.mgr_bulk_price(uuid[], text, numeric),
  public.mgr_import_items(jsonb), public.mgr_save_table(uuid, text, boolean), public.mgr_get_settings(),
  public.mgr_update_settings(text, text, text, int, int), public.mgr_get_staff(), public.mgr_report(text), public.mgr_get_audit(int, bigint),
  public.owner_add_staff(uuid, uuid, text, text), public.owner_set_staff(uuid, uuid, text, text, boolean), public.owner_check_staff(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mgr_get_menu(), public.mgr_save_category(uuid, text, boolean), public.mgr_delete_category(uuid),
  public.mgr_reorder_categories(uuid[]),
  public.mgr_save_item(uuid, uuid, text, text, int, text, int, text, boolean, boolean, boolean), public.mgr_delete_item(uuid),
  public.mgr_duplicate_item(uuid), public.mgr_reorder_items(uuid, uuid[]), public.mgr_bulk_price(uuid[], text, numeric),
  public.mgr_import_items(jsonb), public.mgr_save_table(uuid, text, boolean), public.mgr_get_settings(),
  public.mgr_update_settings(text, text, text, int, int), public.mgr_get_staff(), public.mgr_report(text), public.mgr_get_audit(int, bigint)
  to authenticated;
grant execute on function public.owner_add_staff(uuid, uuid, text, text), public.owner_set_staff(uuid, uuid, text, text, boolean),
  public.owner_check_staff(uuid, uuid) to service_role;

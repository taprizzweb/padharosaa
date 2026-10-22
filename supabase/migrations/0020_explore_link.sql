-- 0020_explore_link
-- The public menu no longer shows Call / WhatsApp / Instagram / Directions / Google-review buttons. It shows one
-- button, "Explore more before leaving", that opens https://smarty.taprizz.in/sq/<code>. The owner types only <code>.
-- The old phone / whatsapp / instagram columns stay in the table (unused, nothing reads or shows them).
-- Idempotent. Rollback: restore guest_get_menu / mgr_get_settings / mgr_update_profile / mgr_analytics from 0017 / 0018.

alter table public.restaurants add column if not exists explore_code text;
do $$ begin
  alter table public.restaurants add constraint restaurants_explore_code check (explore_code is null or explore_code ~ '^[A-Za-z0-9_-]{1,64}$');
exception when duplicate_object then null;
end $$;

alter table public.menu_events drop constraint if exists menu_events_event;
alter table public.menu_events add constraint menu_events_event check (event in (
  'menu_opened','qr_landing','category_viewed','item_viewed','search',
  'whatsapp_click','call_click','directions_click','instagram_click','google_review_click','cart_add','explore_click'));

drop function if exists public.mgr_update_profile(text, text, text, text, text, text, text, text, text);
create or replace function public.mgr_update_profile(
  p_tagline text, p_description text, p_logo text, p_banner text, p_address text, p_hours text, p_explore text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner']);
begin
  update public.restaurants set
    tagline = nullif(btrim(coalesce(p_tagline, '')), ''),
    description = nullif(btrim(coalesce(p_description, '')), ''),
    logo_path = nullif(btrim(coalesce(p_logo, '')), ''),
    banner_path = nullif(btrim(coalesce(p_banner, '')), ''),
    address = nullif(btrim(coalesce(p_address, '')), ''),
    hours_text = nullif(btrim(coalesce(p_hours, '')), ''),
    explore_code = nullif(btrim(coalesce(p_explore, '')), '')
  where id = v_rid;
exception when check_violation then
  raise exception using errcode = 'GM015', message = 'invalid_input';
end $$;
revoke all on function public.mgr_update_profile(text, text, text, text, text, text, text) from public, anon, service_role;
grant execute on function public.mgr_update_profile(text, text, text, text, text, text, text) to authenticated;

create or replace function public.mgr_get_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_read(array['owner','manager']);
begin
  return (select jsonb_build_object('name', r.name, 'slug', r.slug, 'review_url', r.review_url, 'accent', r.accent,
            'amber_minutes', r.amber_minutes, 'red_minutes', r.red_minutes, 'plan', r.plan, 'paid_until', r.paid_until,
            'status', r.status, 'role', private.my_role(), 'id', r.id,
            'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
            'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code,
            'geo_required', r.geo_required, 'geo_lat', r.geo_lat, 'geo_lng', r.geo_lng, 'geo_radius_m', r.geo_radius_m)
          from public.restaurants r where r.id = v_rid);
end $$;

create or replace function public.guest_get_menu(p_slug text, p_token text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table_label text;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.status <> 'active' then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  if p_token is not null then
    select t.label into v_table_label from public.dining_tables t
     where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  return jsonb_build_object(
    'status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent,
      'tagline', r.tagline, 'description', r.description, 'logo_path', r.logo_path, 'banner_path', r.banner_path,
      'address', r.address, 'hours_text', r.hours_text, 'explore_code', r.explore_code),
    'table_label', v_table_label,
    'token_valid', v_table_label is not null,
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

create or replace function public.mgr_analytics(p_range text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_read(array['owner','manager']);
  v_days int := case p_range when '7d' then 7 when '30d' then 30 when '90d' then 90 end;
  v_from timestamptz;
begin
  if v_days is null then raise exception using errcode = 'GM015', message = 'invalid_input'; end if;
  v_from := (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => v_days - 1)) at time zone 'Asia/Kolkata';
  return jsonb_build_object(
    'range', p_range, 'from', v_from,
    'totals', (select jsonb_build_object(
        'menu_opens', count(*) filter (where event = 'menu_opened'),
        'visits', count(distinct visit_id),
        'qr_landings', count(*) filter (where event = 'qr_landing'),
        'item_views', count(*) filter (where event = 'item_viewed'),
        'searches', count(*) filter (where event = 'search'),
        'cart_adds', count(*) filter (where event = 'cart_add'),
        'whatsapp', count(*) filter (where event = 'whatsapp_click'),
        'calls', count(*) filter (where event = 'call_click'),
        'directions', count(*) filter (where event = 'directions_click'),
        'instagram', count(*) filter (where event = 'instagram_click'),
        'google_review', count(*) filter (where event = 'google_review_click'),
        'explore', count(*) filter (where event = 'explore_click'))
      from public.menu_events where restaurant_id = v_rid and created_at >= v_from),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d::date, 'opens', coalesce(c.opens, 0), 'visits', coalesce(c.visits, 0)) order by d)
        from generate_series((v_from at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date, interval '1 day') d
        left join (select (created_at at time zone 'Asia/Kolkata')::date as day,
                          count(*) filter (where event = 'menu_opened')::int as opens, count(distinct visit_id)::int as visits
                     from public.menu_events where restaurant_id = v_rid and created_at >= v_from group by 1) c on c.day = d::date), '[]'::jsonb),
    'top_items', coalesce((select jsonb_agg(t) from (
        select i.name_en as name, count(*)::int as views
          from public.menu_events e join public.items i on i.id = e.item_id and i.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'item_viewed' and e.created_at >= v_from
         group by i.name_en order by count(*) desc, i.name_en limit 10) t), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(t) from (
        select c.name_en as name, count(*)::int as views
          from public.menu_events e join public.categories c on c.id = e.category_id and c.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'category_viewed' and e.created_at >= v_from
         group by c.name_en order by count(*) desc, c.name_en limit 10) t), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(t) from (
        select dt.label as label, count(*)::int as scans
          from public.menu_events e join public.dining_tables dt on dt.id = e.table_id and dt.restaurant_id = e.restaurant_id
         where e.restaurant_id = v_rid and e.event = 'qr_landing' and e.created_at >= v_from
         group by dt.label order by count(*) desc, dt.label limit 20) t), '[]'::jsonb));
end $$;
revoke all on function public.mgr_analytics(text) from public, anon, service_role;
grant execute on function public.mgr_analytics(text) to authenticated;

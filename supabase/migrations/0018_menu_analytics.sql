-- 0018_menu_analytics
-- Privacy-conscious menu analytics. A visit is identified only by a random per-tab id made in the browser
-- (sessionStorage, never a cookie, no IP, no user agent stored). Events are recorded by a service_role-only
-- function that rate-limits, de-duplicates and purges events older than 180 days. Owners and managers read
-- aggregated numbers through mgr_analytics(); nobody can read the raw table directly.
-- Idempotent. Rollback: drop the two functions and the table.

create table if not exists public.menu_events (
  id            bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  visit_id      uuid not null,
  event         text not null,
  item_id       uuid,
  category_id   uuid,
  table_id      uuid,
  created_at    timestamptz not null default now(),
  constraint menu_events_event check (event in (
    'menu_opened','qr_landing','category_viewed','item_viewed','search',
    'whatsapp_click','call_click','directions_click','instagram_click','google_review_click','cart_add'))
);
create index if not exists menu_events_restaurant_time_idx on public.menu_events (restaurant_id, created_at desc);
create index if not exists menu_events_dedupe_idx on public.menu_events (restaurant_id, visit_id, event, created_at desc);
alter table public.menu_events enable row level security;
revoke all on public.menu_events from public, anon, authenticated;

create or replace function public.guest_record_event(
  p_slug text, p_token text, p_visit uuid, p_event text, p_item uuid, p_category uuid, p_ip_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_table uuid;
  v_window interval;
begin
  select * into r from public.restaurants where slug = p_slug and status = 'active';
  if not found then return false; end if;
  if p_visit is null or p_event is null then return false; end if;
  -- generous per-address cap (cafes share one wifi address); events beyond it are silently dropped
  if p_ip_hash is not null and not private.rl_hit('ev:' || p_ip_hash, 600, 600) then return false; end if;
  if p_token is not null then
    select t.id into v_table from public.dining_tables t where t.qr_token = p_token and t.restaurant_id = r.id and t.active;
  end if;
  if p_event = 'qr_landing' and v_table is null then return false; end if;
  -- the item / category must belong to this restaurant, otherwise ignore the reference
  if p_item is not null and not exists (select 1 from public.items where id = p_item and restaurant_id = r.id) then p_item := null; end if;
  if p_category is not null and not exists (select 1 from public.categories where id = p_category and restaurant_id = r.id) then p_category := null; end if;
  if p_event in ('item_viewed','category_viewed') and coalesce(p_item, p_category) is null then return false; end if;
  -- de-duplication: opening and viewing count once per visit per 30 minutes; taps and searches once per 10 seconds
  v_window := case when p_event in ('menu_opened','qr_landing','item_viewed','category_viewed') then interval '30 minutes' else interval '10 seconds' end;
  if exists (select 1 from public.menu_events e where e.restaurant_id = r.id and e.visit_id = p_visit and e.event = p_event
               and e.item_id is not distinct from p_item and e.category_id is not distinct from p_category
               and e.created_at > now() - v_window) then
    return false;
  end if;
  insert into public.menu_events (restaurant_id, visit_id, event, item_id, category_id, table_id)
  values (r.id, p_visit, p_event, p_item, p_category, v_table);
  -- retention: drop old rows a few at a time so the table never grows without bound
  delete from public.menu_events where id in (select id from public.menu_events where created_at < now() - interval '180 days' limit 200);
  return true;
end $$;
revoke all on function public.guest_record_event(text, text, uuid, text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.guest_record_event(text, text, uuid, text, uuid, uuid, text) to service_role;

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
        'google_review', count(*) filter (where event = 'google_review_click'))
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

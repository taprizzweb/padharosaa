-- 0005_guest_functions
-- Everything a guest can do. Guests never touch tables: the Next.js server calls these functions
-- with the service-role key. Each is SECURITY DEFINER with search_path = '' and executable by
-- service_role ONLY.
--
-- Error codes (SQLSTATE -> message) are mapped to friendly translated text by the app:
--   GM001 restaurant_suspended   GM002 invalid_table_token   GM003 item_unavailable
--   GM004 item_not_found         GM005 duplicate_item        GM006 limit_exceeded
--   GM007 rate_limited           GM008 too_many_pending      GM009 session_closed
--   GM010 invalid_transition     GM011 forbidden             GM012 not_found
--   GM013 unserved_orders        GM014 reason_required       GM015 invalid_input
--   GM016 no_orders              GM017 audit_log_is_append_only
-- Idempotent (create or replace). Rollback: drop the functions.

-- ---------- atomic fixed-window counter ----------
create or replace function private.rl_hit(p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count int;
begin
  insert into public.rate_limits as rl (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update set
    count = case when rl.window_start <= now() - make_interval(secs => p_window_seconds) then 1 else rl.count + 1 end,
    window_start = case when rl.window_start <= now() - make_interval(secs => p_window_seconds) then now() else rl.window_start end
  returning count into v_count;
  return v_count <= p_limit;
end $$;
revoke all on function private.rl_hit(text, int, int) from public, anon, authenticated;

create or replace function public.guest_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean language sql security definer set search_path = '' as $$
  select private.rl_hit(p_key, p_limit, p_window_seconds)
$$;

create or replace function public.guest_purge_rate_limits() returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  delete from public.rate_limits where window_start < now() - interval '1 day';
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.guest_health() returns timestamptz
language sql stable security definer set search_path = '' as $$ select now() $$;

-- ---------- menu ----------
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
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent),
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

-- ---------- place order (atomic) ----------
create or replace function public.guest_place_order(
  p_slug text, p_token text, p_items jsonb, p_note text, p_idem text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c_max_lines   constant int := 25;
  c_max_qty     constant int := 10;
  c_max_total   constant bigint := 1500000;   -- Rs 15,000 in paise
  c_max_pending constant int := 3;            -- un-accepted orders per table session
  c_max_per_10m constant int := 8;            -- orders per table per 10 minutes
  -- Successful orders per IP per 10 min (generous: cafes share one wifi IP). NOTE: a failed call rolls back
  -- its own counter, so throttling of FAILED attempts (token guessing) is done by the route handler through
  -- guest_rate_limit(), which runs and commits in its own transaction before this function is called.
  c_ip_limit    constant int := 60;
  t public.dining_tables;
  r public.restaurants;
  s public.table_sessions;
  o public.orders;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_total bigint;
  v_lines int;
  v_found int;
  v_order_no bigint;
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
    perform 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text);
  exception when others then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)
             where x.item_id is null or x.qty is null or x.qty < 1 or char_length(coalesce(x.note, '')) > 100) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text) where x.qty > c_max_qty) then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  if (select count(distinct x.item_id) from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)) <> v_lines then
    raise exception using errcode = 'GM005', message = 'duplicate_item';
  end if;

  -- the token must belong to the restaurant named in the URL
  select t2.* into t
    from public.dining_tables t2 join public.restaurants r2 on r2.id = t2.restaurant_id
   where t2.qr_token = p_token and r2.slug = p_slug and t2.active;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;

  -- Serialise all ordering for this restaurant (also gives gap-free unique order numbers).
  -- NO KEY UPDATE (not FOR UPDATE): it still excludes other orders, but does not conflict with the
  -- FOR KEY SHARE lock that foreign-key checks (e.g. audit rows written by close-table) take on this row.
  -- Plain FOR UPDATE caused a deadlock between "close table" and "place order" (found by the race test).
  select * into r from public.restaurants where id = t.restaurant_id for no key update;
  if r.status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;

  -- idempotent replay: same key from the same table within the last hour returns the same order
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

  -- lock the item rows (stable order) so prices cannot change before we commit
  perform 1 from public.items i
   where i.restaurant_id = r.id
     and i.id in (select x.item_id from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text))
   order by i.id for share;

  select count(*), sum(i.price_paise::bigint * x.qty) into v_found, v_total
    from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)
    join public.items i on i.id = x.item_id and i.restaurant_id = r.id;
  if v_found <> v_lines then
    raise exception using errcode = 'GM004', message = 'item_not_found';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)
             join public.items i on i.id = x.item_id and i.restaurant_id = r.id
             join public.categories c on c.id = i.category_id and c.restaurant_id = r.id
             where not i.is_available or not c.active) then
    raise exception using errcode = 'GM003', message = 'item_unavailable';
  end if;
  if v_total > c_max_total then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;

  update public.restaurants set order_counter = order_counter + 1 where id = r.id returning order_counter into v_order_no;

  insert into public.orders (restaurant_id, session_id, table_id, order_no, note, total_paise, idempotency_key)
  values (r.id, s.id, t.id, v_order_no, v_note, v_total, p_idem)
  returning * into o;

  insert into public.order_items (order_id, restaurant_id, item_id, name_en_snapshot, name_hi_snapshot,
                                  unit_price_paise, qty, note)
  select o.id, r.id, i.id, i.name_en, i.name_hi, i.price_paise, x.qty, nullif(btrim(coalesce(x.note, '')), '')
    from jsonb_to_recordset(p_items) as x(item_id uuid, qty int, note text)
    join public.items i on i.id = x.item_id and i.restaurant_id = r.id;

  return jsonb_build_object('order_id', o.id, 'order_no', o.order_no, 'total_paise', o.total_paise,
    'session_id', s.id, 'table_label', t.label, 'status', o.status, 'replayed', false);
end $$;

-- ---------- live status for the guest's own table session ----------
create or replace function public.guest_get_status(p_session_id uuid, p_thankyou_minutes int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.table_sessions;
  r public.restaurants;
  v_label text;
begin
  select * into s from public.table_sessions where id = p_session_id;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if s.closed_at is not null and s.closed_at < now() - make_interval(mins => p_thankyou_minutes) then
    return jsonb_build_object('state', 'expired');
  end if;
  select * into r from public.restaurants where id = s.restaurant_id;
  select label into v_label from public.dining_tables where id = s.table_id;
  return jsonb_build_object(
    'state', case when s.closed_at is null then 'open' else 'closed' end,
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent, 'status', r.status),
    'table_label', v_label,
    'pay_mode', s.pay_mode,
    'bill_requested', s.bill_requested_at is not null,
    'total_paise', coalesce(s.final_total_paise, (
        select coalesce(sum(o.total_paise), 0) from public.orders o where o.session_id = s.id and o.status <> 'cancelled')),
    'review_available', s.closed_at is not null and r.review_url is not null,
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'order_no', o.order_no, 'status', o.status, 'note', o.note, 'total_paise', o.total_paise,
        'created_at', o.created_at, 'cancel_reason', o.cancel_reason,
        'items', coalesce((select jsonb_agg(jsonb_build_object('name_en', oi.name_en_snapshot,
                  'name_hi', oi.name_hi_snapshot, 'qty', oi.qty, 'unit_price_paise', oi.unit_price_paise,
                  'note', oi.note) order by oi.name_en_snapshot)
                  from public.order_items oi where oi.order_id = o.id), '[]'::jsonb))
        order by o.created_at)
      from public.orders o where o.session_id = s.id), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object('type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode,
                                          'status', q.status, 'created_at', q.created_at) order by q.created_at)
      from public.service_requests q where q.session_id = s.id and q.status = 'open'), '[]'::jsonb));
end $$;

-- ---------- call waiter / ask for bill (a repeat tap is idempotent) ----------
create or replace function public.guest_create_request(
  p_session_id uuid, p_type text, p_reason text default null, p_pay_mode text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.table_sessions;
  r public.restaurants;
  q public.service_requests;
begin
  if p_type not in ('waiter','bill')
     or (p_type = 'waiter' and (p_reason is null or p_reason not in ('water','cutlery','cleaning','help','other')))
     or (p_type = 'bill' and (p_pay_mode is null or p_pay_mode not in ('cash','upi','card'))) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  select * into s from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if s.closed_at is not null then
    raise exception using errcode = 'GM009', message = 'session_closed';
  end if;
  select * into r from public.restaurants where id = s.restaurant_id;
  if r.status <> 'active' then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  if not private.rl_hit('req:' || s.id::text, 12, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;

  if p_type = 'waiter' then
    insert into public.service_requests (restaurant_id, table_id, session_id, type, reason)
    values (s.restaurant_id, s.table_id, s.id, 'waiter', p_reason)
    on conflict (session_id, type) where status = 'open' do nothing
    returning * into q;
    if q.id is null then
      select * into q from public.service_requests where session_id = s.id and type = 'waiter' and status = 'open';
    end if;
  else
    if not exists (select 1 from public.orders where session_id = s.id and status <> 'cancelled') then
      raise exception using errcode = 'GM016', message = 'no_orders';
    end if;
    insert into public.service_requests (restaurant_id, table_id, session_id, type, pay_mode)
    values (s.restaurant_id, s.table_id, s.id, 'bill', p_pay_mode)
    on conflict (session_id, type) where status = 'open' do update set pay_mode = excluded.pay_mode
    returning * into q;
    update public.table_sessions
       set pay_mode = p_pay_mode, bill_requested_at = coalesce(bill_requested_at, now())
     where id = s.id;
  end if;
  return jsonb_build_object('type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode, 'status', q.status);
end $$;

-- ---------- review button: record the tap, return the link ----------
create or replace function public.guest_record_review_click(p_session_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.table_sessions;
  v_url text;
begin
  select * into s from public.table_sessions where id = p_session_id;
  if not found or s.closed_at is null or s.closed_at < now() - interval '24 hours' then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  select review_url into v_url from public.restaurants where id = s.restaurant_id;
  if v_url is null then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if private.rl_hit('rv:' || s.id::text, 5, 3600) then
    insert into public.review_clicks (restaurant_id, session_id) values (s.restaurant_id, s.id);
  end if;
  return v_url;
end $$;

-- ---------- grants: service_role only ----------
revoke all on function public.guest_rate_limit(text, int, int), public.guest_purge_rate_limits(),
  public.guest_health(), public.guest_get_menu(text, text),
  public.guest_place_order(text, text, jsonb, text, text, text),
  public.guest_get_status(uuid, int),
  public.guest_create_request(uuid, text, text, text),
  public.guest_record_review_click(uuid) from public, anon, authenticated;
grant execute on function public.guest_rate_limit(text, int, int), public.guest_purge_rate_limits(),
  public.guest_health(), public.guest_get_menu(text, text),
  public.guest_place_order(text, text, jsonb, text, text, text),
  public.guest_get_status(uuid, int),
  public.guest_create_request(uuid, text, text, text),
  public.guest_record_review_click(uuid) to service_role;

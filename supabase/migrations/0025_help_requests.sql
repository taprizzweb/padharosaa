-- 0025: "Call for problems" for hotels and guest houses. One shared link per restaurant (reachable from the Smart page): the guest
-- types a room number, taps the problems that apply (towel, water, light, TV, WiFi...), may add a few words, and sends it.
-- It appears at once on the staff screen (reception) next to orders, with a sound, until someone taps Done.
-- The topics are the owner's list (defaults below). The optional room list of 0022 also validates the room here.
-- Like the room and table links, the token only identifies the restaurant; it cannot read anything. Idempotent.
-- Rollback: drop guest_get_help / guest_create_help / mgr_get_help_link / mgr_set_help_link / staff_resolve_help, the table and
-- the two columns; restore staff_get_board from 0015.

alter table public.restaurants
  add column if not exists help_token  text,
  add column if not exists help_topics text[] not null default array[
    'Towel or bedsheet', 'Room cleaning', 'Water not coming', 'Hot water not coming', 'Light not working', 'AC or heater problem',
    'TV not working', 'WiFi not working', 'Room service', 'Door lock or key problem', 'Noise or other guests', 'Medical help'];
do $$ begin
  alter table public.restaurants
    add constraint restaurants_help_token_format check (help_token is null or help_token ~ '^[0-9a-f]{64}$'),
    add constraint restaurants_help_topics_len check (coalesce(array_length(help_topics, 1), 0) <= 20);
exception when duplicate_object then null;
end $$;
create unique index if not exists restaurants_help_token_uq on public.restaurants (help_token) where help_token is not null;

create table if not exists public.help_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  room          text not null,
  topics        text[] not null default '{}',
  note          text,
  status        text not null default 'open',
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users (id) on delete set null,
  constraint help_requests_room check (char_length(room) between 1 and 10),
  constraint help_requests_note check (note is null or char_length(note) <= 300),
  constraint help_requests_topics check (coalesce(array_length(topics, 1), 0) <= 12),
  constraint help_requests_something check (coalesce(array_length(topics, 1), 0) > 0 or note is not null),
  constraint help_requests_status check (status in ('open', 'done'))
);
create index if not exists help_requests_open_idx on public.help_requests (restaurant_id, status, created_at);

-- Staff may read their own restaurant's problems (the live screen listens to this table); only the functions below write.
alter table public.help_requests enable row level security;
drop policy if exists help_requests_select on public.help_requests;
create policy help_requests_select on public.help_requests for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.my_role()) in ('owner', 'manager', 'waiter'));
revoke all on public.help_requests from public, anon, authenticated;
grant select on public.help_requests to authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'help_requests') then
    alter publication supabase_realtime add table public.help_requests;
  end if;
end $$;

-- ---------- owner / manager: the link and its topics ----------
create or replace function public.mgr_get_help_link() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_staff(array['owner','manager']); r public.restaurants;
begin
  select * into r from public.restaurants where id = v_rid;
  return jsonb_build_object('enabled', r.help_token is not null, 'token', r.help_token, 'topics', to_jsonb(r.help_topics));
end $$;

-- p_enabled false switches the link off (token erased); p_rotate makes a new token. Empty topics fall back to the defaults.
create or replace function public.mgr_set_help_link(p_enabled boolean, p_topics text[], p_rotate boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_rid uuid := private.require_staff(array['owner']);
  v_topics text[];
  r public.restaurants;
begin
  if p_enabled is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select coalesce(array_agg(t order by n), '{}') into v_topics from (
    select distinct on (lower(t)) t, n from (
      select btrim(regexp_replace(e, '\s+', ' ', 'g')) as t, n from unnest(coalesce(p_topics, '{}')) with ordinality as u(e, n)) q
     where t <> '' order by lower(t), n) d;
  if exists (select 1 from unnest(v_topics) t where char_length(t) > 40) or coalesce(array_length(v_topics, 1), 0) > 20 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  select * into r from public.restaurants where id = v_rid for update;
  if coalesce(array_length(v_topics, 1), 0) = 0 then
    v_topics := r.help_topics;
    if coalesce(array_length(v_topics, 1), 0) = 0 then
      v_topics := array['Towel or bedsheet', 'Room cleaning', 'Water not coming', 'Light not working', 'TV not working', 'WiFi not working', 'Room service'];
    end if;
  end if;
  update public.restaurants
     set help_topics = v_topics,
         help_token = case when not p_enabled then null
                           when r.help_token is null or coalesce(p_rotate, false)
                             then replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
                           else r.help_token end
   where id = v_rid;
  perform private.write_audit(v_rid, 'help_link_updated', 'restaurants', v_rid::text,
    jsonb_build_object('enabled', p_enabled, 'topics', coalesce(array_length(v_topics, 1), 0), 'rotated', coalesce(p_rotate, false)));
end $$;
revoke all on function public.mgr_get_help_link(), public.mgr_set_help_link(boolean, text[], boolean) from public, anon, service_role;
grant execute on function public.mgr_get_help_link(), public.mgr_set_help_link(boolean, text[], boolean) to authenticated;

-- ---------- guest: what the page needs, and sending a problem (service role only) ----------
create or replace function public.guest_get_help(p_slug text, p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.restaurants;
begin
  select * into r from public.restaurants where slug = p_slug;
  if not found then
    raise exception using errcode = 'GM012', message = 'not_found';
  end if;
  if r.help_token is null or p_token is null or r.help_token <> p_token then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    return jsonb_build_object('status', 'suspended', 'restaurant', jsonb_build_object('name', r.name));
  end if;
  return jsonb_build_object('status', 'active',
    'restaurant', jsonb_build_object('name', r.name, 'slug', r.slug, 'accent', r.accent, 'logo_path', r.logo_path),
    'topics', to_jsonb(r.help_topics),
    'rooms', to_jsonb(r.room_numbers));
end $$;

create or replace function public.guest_create_help(p_slug text, p_token text, p_room text, p_topics text[], p_note text, p_ip_hash text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.restaurants;
  v_room text := upper(regexp_replace(btrim(coalesce(p_room, '')), '\s+', ' ', 'g'));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_topics text[];
  q public.help_requests;
begin
  if p_slug is null or p_token is null then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if p_ip_hash is not null and not private.rl_hit('help:' || p_ip_hash, 20, 600) then
    raise exception using errcode = 'GM007', message = 'rate_limited';
  end if;
  select * into r from public.restaurants where slug = p_slug and help_token = p_token;
  if not found then
    raise exception using errcode = 'GM002', message = 'invalid_table_token';
  end if;
  if r.status <> 'active' or private.plan_expired(r) then
    raise exception using errcode = 'GM001', message = 'restaurant_suspended';
  end if;
  if v_room !~ '^[A-Z0-9][A-Z0-9 -]{0,9}$' or (v_note is not null and char_length(v_note) > 300) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  if coalesce(array_length(r.room_numbers, 1), 0) > 0 and not (v_room = any (r.room_numbers)) then
    raise exception using errcode = 'GM022', message = 'unknown_room';
  end if;
  -- only the owner's topics (any letter case), each once, in the owner's order
  select coalesce(array_agg(t order by n), '{}') into v_topics
    from unnest(r.help_topics) with ordinality as o(t, n)
   where lower(t) in (select lower(btrim(x)) from unnest(coalesce(p_topics, '{}')) x);
  if coalesce(array_length(p_topics, 1), 0) > 12
     or (select count(distinct lower(btrim(x))) from unnest(coalesce(p_topics, '{}')) x) <> coalesce(array_length(v_topics, 1), 0)
     or (coalesce(array_length(v_topics, 1), 0) = 0 and v_note is null) then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;

  -- sending the same thing again within 10 minutes is the same request (a double tap or a retry)
  select * into q from public.help_requests
   where restaurant_id = r.id and room = v_room and status = 'open' and topics = v_topics
     and note is not distinct from v_note and created_at > now() - interval '10 minutes'
   order by created_at desc limit 1;
  if found then
    return jsonb_build_object('id', q.id, 'room', q.room, 'replayed', true);
  end if;
  if (select count(*) from public.help_requests where restaurant_id = r.id and room = v_room and status = 'open') >= 3 then
    raise exception using errcode = 'GM008', message = 'too_many_pending';
  end if;
  if (select count(*) from public.help_requests where restaurant_id = r.id and status = 'open') >= 300 then
    raise exception using errcode = 'GM006', message = 'limit_exceeded';
  end if;
  insert into public.help_requests (restaurant_id, room, topics, note) values (r.id, v_room, v_topics, v_note) returning * into q;
  return jsonb_build_object('id', q.id, 'room', q.room, 'replayed', false);
end $$;
revoke all on function public.guest_get_help(text, text), public.guest_create_help(text, text, text, text[], text, text) from public, anon, authenticated;
grant execute on function public.guest_get_help(text, text), public.guest_create_help(text, text, text, text[], text, text) to service_role;

-- ---------- staff: mark a problem done ----------
create or replace function public.staff_resolve_help(p_help_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid; q public.help_requests;
begin
  v_rid := private.require_staff(array['owner','manager','waiter']);
  update public.help_requests set status = 'done', resolved_at = now(), resolved_by = auth.uid()
   where id = p_help_id and restaurant_id = v_rid and status = 'open'
   returning * into q;
  if not found then
    -- already done (double tap) is fine; a missing or foreign id is not
    select * into q from public.help_requests where id = p_help_id and restaurant_id = v_rid;
    if not found then
      raise exception using errcode = 'GM012', message = 'not_found';
    end if;
  end if;
  return jsonb_build_object('help_id', q.id, 'status', q.status);
end $$;
revoke all on function public.staff_resolve_help(uuid) from public, anon, service_role;
grant execute on function public.staff_resolve_help(uuid) to authenticated;

-- ---------- the staff board also carries the open problems (not for the kitchen) ----------
create or replace function public.staff_get_board() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rid uuid;
  v_role text;
begin
  select s.restaurant_id, s.role into v_rid, v_role from public.staff s where s.user_id = auth.uid() and s.active;
  if v_rid is null then
    raise exception using errcode = 'GM011', message = 'forbidden';
  end if;
  return jsonb_build_object(
    'server_time', now(),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'order_no', o.order_no, 'status', o.status, 'table_label', t.label, 'session_id', o.session_id,
        'note', o.note, 'total_paise', o.total_paise, 'created_at', o.created_at, 'preparing_at', o.preparing_at,
        'ready_at', o.ready_at,
        'items', coalesce((select jsonb_agg(jsonb_build_object('name', oi.name_en_snapshot, 'qty', oi.qty, 'note', oi.note)
                                            order by oi.name_en_snapshot)
                           from public.order_items oi where oi.order_id = o.id), '[]'::jsonb))
        order by o.created_at)
      from public.orders o
      join public.dining_tables t on t.id = o.table_id
      join public.table_sessions s on s.id = o.session_id
      where o.restaurant_id = v_rid and s.closed_at is null and o.status in ('placed', 'preparing', 'ready')), '[]'::jsonb),
    -- the kitchen does not handle waiter calls, bills or payment
    'requests', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'type', q.type, 'reason', q.reason, 'pay_mode', q.pay_mode, 'table_label', t.label,
        'session_id', q.session_id, 'created_at', q.created_at) order by q.created_at)
      from public.service_requests q join public.dining_tables t on t.id = q.table_id
      where q.restaurant_id = v_rid and q.status = 'open'), '[]'::jsonb) end,
    'sessions', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'table_label', t.label, 'opened_at', s.opened_at, 'pay_mode', s.pay_mode,
        'bill_requested_at', s.bill_requested_at,
        'total_paise', coalesce((select sum(o.total_paise) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'), 0),
        'orders_count', (select count(*) from public.orders o where o.session_id = s.id and o.status <> 'cancelled'),
        'unserved_count', (select count(*) from public.orders o where o.session_id = s.id and o.status in ('placed', 'preparing', 'ready')))
        order by s.opened_at)
      from public.table_sessions s join public.dining_tables t on t.id = s.table_id
      where s.restaurant_id = v_rid and s.closed_at is null), '[]'::jsonb) end,
    'help', case when v_role = 'kitchen' then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'room', h.room, 'topics', to_jsonb(h.topics), 'note', h.note, 'created_at', h.created_at)
                       order by h.created_at)
      from public.help_requests h where h.restaurant_id = v_rid and h.status = 'open'), '[]'::jsonb) end);
end $$;

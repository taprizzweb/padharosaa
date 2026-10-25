-- 0062_wifi_vouchers
-- Some hotels give every guest their own Wi-Fi login (a username of numbers and a short password, issued by the hotel's Wi-Fi system).
-- The owner or manager pastes the list once. When a guest opens "Stay & Wi-Fi" they are given the next unused login; everyone in the same room
-- shares it while they are staying, and the next guest of that room gets a new one. A used login is never given again. A hotel with no
-- logins in the list keeps the single shared Wi-Fi name and password as before.
-- Idempotent. Rollback: drop the functions and the table.
create table if not exists public.wifi_vouchers (
  id            uuid primary key default gen_random_uuid(),
  seq           bigint generated always as identity, -- the order the logins were pasted in
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  username      text not null check (char_length(username) between 1 and 64),
  password_enc  bytea not null,
  session_id    uuid references public.guest_sessions (id) on delete set null,
  room_id       uuid,
  assigned_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, username)
);
create index if not exists wifi_vouchers_free_idx on public.wifi_vouchers (restaurant_id, seq) where assigned_at is null;
create index if not exists wifi_vouchers_session_idx on public.wifi_vouchers (session_id) where session_id is not null;
alter table public.wifi_vouchers enable row level security; -- no policy: reached only through the functions below

-- owner / manager: add logins. p_items is JSON text: a list of {username, password_enc (hex)}; duplicates of a username are skipped
create or replace function public.padh_wifi_vouchers_add(p_items text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']); v_items jsonb; i jsonb; v_added int := 0; v_n int;
begin
  begin v_items := p_items::jsonb; exception when others then raise exception using errcode = 'GM015', message = 'invalid_input'; end;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or (case when jsonb_typeof(v_items) = 'array' then jsonb_array_length(v_items) else 0 end) not between 1 and 2000 then
    raise exception using errcode = 'GM015', message = 'invalid_input';
  end if;
  for i in select * from jsonb_array_elements(v_items) loop
    if jsonb_typeof(i) <> 'object' or char_length(coalesce(i->>'username', '')) not between 1 and 64 or coalesce(i->>'password_enc', '') !~ '^[0-9a-f]{2,255}$' then
      raise exception using errcode = 'GM015', message = 'invalid_input';
    end if;
    insert into public.wifi_vouchers (restaurant_id, username, password_enc) values (v_rid, i->>'username', decode(i->>'password_enc', 'hex'))
    on conflict (restaurant_id, username) do nothing;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;
  end loop;
  perform private.write_audit(v_rid, 'padh_wifi_vouchers_add', 'wifi_vouchers', v_rid::text, jsonb_build_object('added', v_added));
  return jsonb_build_object('added', v_added, 'skipped', jsonb_array_length(v_items) - v_added);
end $$;
revoke all on function public.padh_wifi_vouchers_add(text) from public, anon, service_role;
grant execute on function public.padh_wifi_vouchers_add(text) to authenticated;

create or replace function public.padh_wifi_vouchers_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_rid uuid := private.require_hotel_staff(array['owner','manager']);
begin
  return jsonb_build_object(
    'free', (select count(*) from public.wifi_vouchers where restaurant_id = v_rid and assigned_at is null),
    'given', (select count(*) from public.wifi_vouchers where restaurant_id = v_rid and assigned_at is not null));
end $$;
revoke all on function public.padh_wifi_vouchers_status() from public, anon, service_role;
grant execute on function public.padh_wifi_vouchers_status() to authenticated;

-- guest: the login of this guest's room (given on first look), or null when the hotel has no list or it has run out
create or replace function public.padh_guest_wifi(p_session uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s public.guest_sessions; v public.wifi_vouchers;
begin
  select * into s from public.guest_sessions where id = p_session and status = 'active';
  if not found then raise exception using errcode = 'GM009', message = 'session_closed'; end if;
  select v2.* into v from public.wifi_vouchers v2 join public.guest_sessions g on g.id = v2.session_id
   where v2.restaurant_id = s.restaurant_id and g.room_id = s.room_id and g.status = 'active' order by v2.assigned_at desc limit 1;
  if not found then
    select * into v from public.wifi_vouchers where restaurant_id = s.restaurant_id and assigned_at is null order by seq limit 1 for update skip locked;
    if not found then return null; end if;
    update public.wifi_vouchers set session_id = s.id, room_id = s.room_id, assigned_at = now() where id = v.id returning * into v;
  end if;
  return jsonb_build_object('username', v.username, 'password_enc', encode(v.password_enc, 'hex'));
end $$;
revoke all on function public.padh_guest_wifi(uuid) from public, anon, authenticated;
grant execute on function public.padh_guest_wifi(uuid) to service_role;

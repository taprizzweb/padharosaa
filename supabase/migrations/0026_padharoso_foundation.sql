-- 0026_padharoso_foundation
-- Padharoso (hotel concierge) foundation. A restaurant becomes a Padharoso hotel only when it has a `hotel_settings` row
-- with enabled = true; every other restaurant (Menu Lite) is untouched. Nothing here changes an existing table except a
-- read-only backfill of `rooms` from restaurants.room_numbers.
--
-- Naming: the spec's `hotel_id` is `restaurant_id` here so the existing helpers (private.my_restaurant_id, composite FKs) work.
-- Staff roles map owner/manager -> manager, waiter -> reception/concierge, kitchen -> kitchen.
-- Guests have no JWT: they never touch these tables directly (service-role functions only, added in later migrations).
-- Sensitive columns (mobile_enc, mobile_hash, token_hash, qr_key_hash, wifi_password_enc, stay-code hashes) are excluded from every
-- grant, so even staff cannot read them through the API.
-- Idempotent. Rollback: drop the five tables below (in reverse order) and private.is_hotel().

-- ---------- hotel_settings (1:1 with restaurants) ----------
create table if not exists public.hotel_settings (
  restaurant_id        uuid primary key references public.restaurants(id) on delete cascade,
  enabled              boolean not null default true,
  timezone             text not null default 'Asia/Kolkata' check (char_length(timezone) between 3 and 60),
  theme                text not null default 'palace_blue' check (theme in ('palace_blue','terracotta','midnight_indigo')),
  backdrop_mode        text not null default 'plain' check (backdrop_mode in ('stencil','illustration','pattern','plain','photo')),
  backdrop_svg_path    text check (backdrop_svg_path is null or char_length(backdrop_svg_path) <= 300),
  wifi_name            text check (wifi_name is null or char_length(wifi_name) <= 60),
  wifi_password_enc    bytea,
  reception_phone      text check (reception_phone is null or reception_phone ~ '^[0-9]{10,15}$'),
  manager_phone        text check (manager_phone is null or manager_phone ~ '^[0-9]{10,15}$'),
  entrance_maps_url    text check (entrance_maps_url is null or (entrance_maps_url ~ '^https://[^[:space:]]+$' and char_length(entrance_maps_url) <= 500)),
  review_link          text check (review_link is null or (review_link ~ '^https://[^[:space:]]+$' and char_length(review_link) <= 500)),
  verification_level   text not null default 'light' check (verification_level in ('off','light','strict','verified')),
  kitchen_open         time,
  kitchen_close        time,
  buffet_reminder_default boolean not null default true,
  qr_key_hash          bytea,
  qr_key_rotated_at    timestamptz not null default now(),
  max_stay_days        int not null default 14 check (max_stay_days between 1 and 60),
  is_mock              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- true when the restaurant runs Padharoso (used by later functions; Lite restaurants return false)
create or replace function private.is_hotel(p_restaurant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hotel_settings h where h.restaurant_id = p_restaurant and h.enabled)
$$;
revoke all on function private.is_hotel(uuid) from public, anon;
grant execute on function private.is_hotel(uuid) to authenticated;

-- ---------- rooms ----------
create table if not exists public.rooms (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  number        text not null check (number ~ '^[A-Z0-9][A-Z0-9 -]{0,9}$'),
  floor         text check (floor is null or char_length(floor) <= 20),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, number),
  unique (id, restaurant_id)
);

-- one-off, read-only backfill from the existing room-service list (does not change restaurants)
insert into public.rooms (restaurant_id, number)
select r.id, n
from public.restaurants r, unnest(r.room_numbers) n
where n ~ '^[A-Z0-9][A-Z0-9 -]{0,9}$'
on conflict do nothing;

-- ---------- concierge shifts ----------
create table if not exists public.concierge_shifts (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  label          text not null check (char_length(label) between 1 and 40),
  start_time     time not null,
  end_time       time not null,
  staff_name     text not null check (char_length(staff_name) between 1 and 60),
  staff_mobile   text check (staff_mobile is null or staff_mobile ~ '^[0-9]{10,15}$'),
  alert_whatsapp boolean not null default true,
  sort           int not null default 0,
  check (start_time <> end_time) -- a shift may cross midnight (end < start) but cannot be empty
);

-- ---------- stay codes (hashed; never readable through the API) ----------
create table if not exists public.stay_codes (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  room_id       uuid not null,
  code_hash     bytea not null,
  salt          bytea not null,
  valid_from    timestamptz not null default now(),
  valid_until   timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  foreign key (room_id, restaurant_id) references public.rooms (id, restaurant_id) on delete cascade
);
create index if not exists stay_codes_room_idx on public.stay_codes (restaurant_id, room_id, valid_from desc);

-- ---------- guest sessions ----------
create table if not exists public.guest_sessions (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  room_id       uuid not null,
  guest_name    text not null check (char_length(guest_name) between 2 and 80),
  mobile_cc     text not null check (mobile_cc ~ '^\+[0-9]{1,3}$'),
  mobile_enc    bytea not null,
  mobile_hash   bytea not null,
  language      text not null default 'en' check (language in ('en','hi','fr','es','de')),
  diet          text check (diet in ('vegetarian','jain','vegan','non_vegetarian')),
  occasion      text check (occasion in ('birthday','anniversary','honeymoon')),
  token_hash    bytea not null,
  verification  text not null default 'none' check (verification in ('none','code','otp')),
  push_subscription jsonb,
  consent_messaging boolean not null default false,
  consent_at    timestamptz,
  status        text not null default 'active' check (status in ('active','ended','blocked','expired')),
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  ended_at      timestamptz,
  foreign key (room_id, restaurant_id) references public.rooms (id, restaurant_id),
  unique (id, restaurant_id)
);
create unique index if not exists guest_sessions_token_uq on public.guest_sessions (token_hash);
create index if not exists guest_sessions_hotel_status_idx on public.guest_sessions (restaurant_id, status);
create index if not exists guest_sessions_room_active_idx on public.guest_sessions (restaurant_id, room_id) where status = 'active';

-- ---------- RLS: on everywhere; staff read their own hotel only; no client writes at all ----------
alter table public.hotel_settings   enable row level security;
alter table public.rooms            enable row level security;
alter table public.concierge_shifts enable row level security;
alter table public.stay_codes       enable row level security; -- no policy, no grant: unreachable from the API
alter table public.guest_sessions   enable row level security;

drop policy if exists hotel_settings_select on public.hotel_settings;
create policy hotel_settings_select on public.hotel_settings for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

drop policy if exists concierge_shifts_select on public.concierge_shifts;
create policy concierge_shifts_select on public.concierge_shifts for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()));

-- kitchen gets no direct read (spec 7.5 "limited": room and diet only reach the kitchen through the kitchen functions added later)
drop policy if exists guest_sessions_select on public.guest_sessions;
create policy guest_sessions_select on public.guest_sessions for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id())
         and (select private.my_role()) in ('owner','manager','waiter'));

-- ---------- grants: SELECT on safe columns only ----------
grant select (restaurant_id, enabled, timezone, theme, backdrop_mode, backdrop_svg_path, wifi_name, reception_phone, manager_phone,
              entrance_maps_url, review_link, verification_level, kitchen_open, kitchen_close, buffet_reminder_default,
              qr_key_rotated_at, max_stay_days, is_mock, created_at, updated_at)
  on public.hotel_settings to authenticated;
grant select on public.rooms, public.concierge_shifts to authenticated;
grant select (id, restaurant_id, room_id, guest_name, mobile_cc, language, diet, occasion, verification, consent_messaging,
              status, started_at, last_seen_at, ended_at)
  on public.guest_sessions to authenticated;

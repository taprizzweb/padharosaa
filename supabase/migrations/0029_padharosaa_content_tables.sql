-- 0029_padharosaa_content_tables
-- The remaining Padharosaa tables: buffet, Jaipur guide, itineraries, guest plans, bookings, places (review engine), notifications, feedback.
-- Structure, constraints and read-only RLS only. The functions that write to them arrive with their own phases (buffet in Phase 6,
-- bookings/feedback in 7, guide and plans in 8, notifications in 9, places in 11). Until then nothing can write to these tables
-- except the migration owner: no client has any INSERT/UPDATE/DELETE grant.
--
-- Mock safety (spec 11.3): guide_items, itineraries and places carry is_mock. A row with data_source = 'mock' MUST be is_mock, and
-- `npm run check:no-mock` fails when any is_mock row is active in a production database.
-- Naming: the spec's `plans` is `guest_plans` here (the billing table `plans` already exists).
-- Idempotent. Rollback: drop the tables in reverse order of creation.

-- ---------- buffet (one row per hotel per day) ----------
create table if not exists public.buffets (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null references public.restaurants(id) on delete cascade,
  service_date     date not null,
  mode             text not null check (mode in ('in_house','outdoor','none')),
  name             text check (name is null or char_length(name) <= 80),
  start_time       time,
  end_time         time,
  venue            text check (venue is null or char_length(venue) <= 80),
  highlights       text check (highlights is null or char_length(highlights) <= 300),
  mood             text check (mood is null or char_length(mood) <= 80),
  reminder_on      boolean not null default true,
  version          int not null default 1,
  notified_version int not null default 0,
  notified_t60     boolean not null default false,
  notified_t90     boolean not null default false,
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  unique (restaurant_id, service_date),
  check (mode = 'none' or (name is not null and start_time is not null and end_time is not null and start_time <> end_time))
);

-- ---------- Jaipur guide ----------
create table if not exists public.guide_items (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  category        text not null check (category in ('place','food','craft','tip')),
  name            text not null check (char_length(name) between 1 and 100),
  description_en  text check (description_en is null or char_length(description_en) <= 600),
  description_hi  text check (description_hi is null or char_length(description_hi) <= 600),
  description_fr  text check (description_fr is null or char_length(description_fr) <= 600),
  description_es  text check (description_es is null or char_length(description_es) <= 600),
  description_de  text check (description_de is null or char_length(description_de) <= 600),
  maps_query      text check (maps_query is null or char_length(maps_query) <= 200),
  link_url        text check (link_url is null or (link_url ~ '^https://[^[:space:]]+$' and char_length(link_url) <= 500)),
  active          boolean not null default true,
  sort            int not null default 0,
  last_verified_at date,
  verified_by     uuid references auth.users(id),
  is_mock         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists guide_items_hotel_idx on public.guide_items (restaurant_id, category, sort);

create table if not exists public.itineraries (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 100),
  tagline       text check (tagline is null or char_length(tagline) <= 160),
  tip           text check (tip is null or char_length(tip) <= 400),
  active        boolean not null default true,
  sort          int not null default 0,
  is_mock       boolean not null default false,
  unique (id, restaurant_id)
);
create table if not exists public.itinerary_stops (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null,
  itinerary_id   uuid not null,
  when_label     text not null check (char_length(when_label) between 1 and 40),
  name           text not null check (char_length(name) between 1 and 100),
  note           text check (note is null or char_length(note) <= 300),
  maps_query     text check (maps_query is null or char_length(maps_query) <= 200),
  sort           int not null default 0,
  foreign key (itinerary_id, restaurant_id) references public.itineraries (id, restaurant_id) on delete cascade
);

-- ---------- a guest's own plan ("My plan") ----------
create table if not exists public.guest_plans (
  id               uuid primary key default gen_random_uuid(),
  restaurant_id    uuid not null,
  session_id       uuid not null unique,
  sent_to_phone_at timestamptz,
  requested_at     timestamptz,
  foreign key (session_id, restaurant_id) references public.guest_sessions (id, restaurant_id) on delete cascade,
  unique (id, restaurant_id)
);
create table if not exists public.guest_plan_items (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  plan_id       uuid not null,
  name          text not null check (char_length(name) between 1 and 100),
  when_label    text check (when_label is null or char_length(when_label) <= 40),
  maps_query    text check (maps_query is null or char_length(maps_query) <= 200),
  sort          int not null default 0,
  foreign key (plan_id, restaurant_id) references public.guest_plans (id, restaurant_id) on delete cascade
);

-- ---------- bookings (reservation, skip-the-line, artisan, vista) tied to a request ----------
create table if not exists public.bookings (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  request_id    uuid not null unique,
  kind          text not null check (kind in ('reservation','skip_line','artisan','vista')),
  place_id      uuid,
  what          text not null check (char_length(what) between 1 and 120),
  on_date       date not null,
  at_time       time not null,
  party_size    int not null check (party_size between 1 and 20),
  status        text not null default 'requested' check (status in ('requested','confirmed','declined','cancelled')),
  note          text check (note is null or char_length(note) <= 300),
  confirmed_by  uuid references auth.users(id),
  confirmed_at  timestamptz,
  foreign key (request_id, restaurant_id) references public.requests (id, restaurant_id) on delete cascade
);

-- ---------- places: review / place data engine (spec part 9) ----------
create table if not exists public.places (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references public.restaurants(id) on delete cascade,
  google_place_id       text check (google_place_id is null or google_place_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  name                  text not null check (char_length(name) between 1 and 120),
  category              text check (category is null or char_length(category) <= 60),
  lat                   numeric(9,6) check (lat is null or lat between -90 and 90),
  lng                   numeric(9,6) check (lng is null or lng between -180 and 180),
  address               text check (address is null or char_length(address) <= 200),
  rating                numeric(2,1) check (rating is null or rating between 0 and 5),
  review_count          int check (review_count is null or review_count >= 0),
  featured_review       text check (featured_review is null or char_length(featured_review) <= 500),
  featured_review_author text check (featured_review_author is null or char_length(featured_review_author) <= 80),
  featured_review_url   text check (featured_review_url is null or featured_review_url ~ '^https://[^[:space:]]+$'),
  direct_review_link    text check (direct_review_link is null or direct_review_link ~ '^https://(search\.google\.com|www\.google\.com|g\.page|maps\.app\.goo\.gl)/[^[:space:]]*$'),
  data_source           text not null default 'manual' check (data_source in ('manual','places_api','business_profile','mock')),
  fetched_at            timestamptz,
  is_mock               boolean not null default false,
  verified_at           date,
  verified_by           uuid references auth.users(id),
  active                boolean not null default true,
  -- a mock record can never look real, and a real source can never be flagged mock by accident
  check ((data_source = 'mock') = is_mock),
  -- a rating without a source and a fetch date is invented data
  check (rating is null or data_source = 'mock' or fetched_at is not null or verified_at is not null)
);
create index if not exists places_hotel_idx on public.places (restaurant_id, active);

-- ---------- notifications (queue + delivery receipts; no message bodies, no personal data in payload) ----------
create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  channel       text not null check (channel in ('push','whatsapp','sms','email')),
  to_ref        text not null check (char_length(to_ref) <= 200), -- a session id, a staff id, or an encrypted-number reference
  template      text not null check (char_length(template) between 1 and 80),
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'queued' check (status in ('queued','sent','delivered','failed','suppressed')),
  attempts      int not null default 0,
  last_error    text check (last_error is null or char_length(last_error) <= 300),
  dedupe_key    text unique check (dedupe_key is null or char_length(dedupe_key) <= 200),
  scheduled_at  timestamptz not null default now(),
  sent_at       timestamptz
);
create index if not exists notifications_queue_idx on public.notifications (status, scheduled_at) where status = 'queued';

-- ---------- feedback ("How was it?") ----------
create table if not exists public.feedback (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null,
  session_id    uuid not null,
  request_id    uuid,
  rating        text not null check (rating in ('great','okay','not_good')),
  followup_status text not null default 'open' check (followup_status in ('open','done')),
  created_at    timestamptz not null default now(),
  foreign key (session_id, restaurant_id) references public.guest_sessions (id, restaurant_id) on delete cascade,
  foreign key (request_id, restaurant_id) references public.requests (id, restaurant_id) on delete set null (request_id)
);

-- ---------- RLS: on everywhere; staff read their own hotel; no client writes ----------
alter table public.buffets          enable row level security;
alter table public.guide_items      enable row level security;
alter table public.itineraries      enable row level security;
alter table public.itinerary_stops  enable row level security;
alter table public.guest_plans      enable row level security;
alter table public.guest_plan_items enable row level security;
alter table public.bookings         enable row level security;
alter table public.places           enable row level security;
alter table public.notifications    enable row level security;
alter table public.feedback         enable row level security;

do $$
declare t text;
begin
  -- readable by every staff role of the hotel (kitchen needs the buffet; the guide is shared knowledge)
  foreach t in array array['buffets','guide_items','itineraries','itinerary_stops','places'] loop
    execute format('drop policy if exists %1$I_select on public.%1$I', t);
    execute format('create policy %1$I_select on public.%1$I for select to authenticated using (restaurant_id = (select private.my_restaurant_id()))', t);
  end loop;
  -- front-line staff and managers only
  foreach t in array array['guest_plans','guest_plan_items','bookings','feedback'] loop
    execute format('drop policy if exists %1$I_select on public.%1$I', t);
    execute format($f$create policy %1$I_select on public.%1$I for select to authenticated
                      using (restaurant_id = (select private.my_restaurant_id()) and (select private.my_role()) in ('owner','manager','waiter'))$f$, t);
  end loop;
end $$;
drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (restaurant_id = (select private.my_restaurant_id()) and (select private.my_role()) in ('owner','manager'));

grant select on public.buffets, public.guide_items, public.itineraries, public.itinerary_stops, public.places,
                public.guest_plans, public.guest_plan_items, public.bookings, public.feedback to authenticated;
-- the queue exposes status only: addresses and payloads stay server-side
grant select (id, restaurant_id, channel, template, status, attempts, last_error, scheduled_at, sent_at) on public.notifications to authenticated;

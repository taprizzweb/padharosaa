-- 0002_core_tables
-- All business tables. Money = integer paise. Every business table carries restaurant_id.
-- Cross-tenant references are impossible: child rows reference parents with COMPOSITE foreign
-- keys (id, restaurant_id), so a row can never point at another restaurant's row.
-- Idempotent (IF NOT EXISTS). Rollback: DROP TABLE ... CASCADE in reverse order (data loss).

create table if not exists public.restaurants (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  status         text not null default 'active',
  plan           text not null default 'pilot',
  paid_until     timestamptz,
  review_url     text,
  accent         text not null default 'saffron',
  order_counter  bigint not null default 0,
  amber_minutes  int not null default 5,
  red_minutes    int not null default 10,
  created_at     timestamptz not null default now(),
  constraint restaurants_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' and slug !~ '--'),
  constraint restaurants_slug_reserved check (slug <> all (array[
    'admin','staff','dash','dashboard','api','login','logout','auth','_next','static','assets','health',
    'privacy','terms','support','dev','public','app','www','mail','help','about','contact','signup',
    'register','settings','account','status','favicon','robots','sitemap','manifest','sw','offline',
    'images','img','menu','demo','test','null','undefined'])),
  constraint restaurants_name_len check (char_length(name) between 1 and 80),
  constraint restaurants_status check (status in ('active','suspended')),
  constraint restaurants_plan_len check (char_length(plan) between 1 and 30),
  constraint restaurants_review_url check (review_url is null or (review_url ~ '^https://[^[:space:]]+$' and char_length(review_url) <= 500)),
  constraint restaurants_accent check (accent in ('saffron','tomato','emerald','teal','indigo','plum','rose','slate')),
  constraint restaurants_counter check (order_counter >= 0),
  constraint restaurants_thresholds check (amber_minutes between 1 and 120 and red_minutes between 1 and 240 and red_minutes > amber_minutes)
);

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.staff (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  role          text not null,
  display_name  text not null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint staff_role check (role in ('owner','manager','waiter','kitchen')),
  constraint staff_name_len check (char_length(display_name) between 1 and 60)
);
create index if not exists staff_restaurant_idx on public.staff (restaurant_id);

create table if not exists public.categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name_en       text not null,
  name_hi       text,
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint categories_name_en_len check (char_length(name_en) between 1 and 60),
  constraint categories_name_hi_len check (name_hi is null or char_length(name_hi) between 1 and 60),
  constraint categories_id_restaurant_uq unique (id, restaurant_id)
);
create index if not exists categories_restaurant_idx on public.categories (restaurant_id, sort_order);

create table if not exists public.items (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  category_id    uuid not null,
  name_en        text not null,
  name_hi        text,
  description_en text,
  description_hi text,
  price_paise    int not null,
  diet           text not null default 'veg',
  spice          smallint not null default 0,
  image_path     text,
  is_available   boolean not null default true,
  is_bestseller  boolean not null default false,
  is_chef_pick   boolean not null default false,
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  constraint items_category_fk foreign key (category_id, restaurant_id)
    references public.categories (id, restaurant_id) ,
  constraint items_id_restaurant_uq unique (id, restaurant_id),
  constraint items_name_en_len check (char_length(name_en) between 1 and 80),
  constraint items_name_hi_len check (name_hi is null or char_length(name_hi) between 1 and 80),
  constraint items_desc_en_len check (description_en is null or char_length(description_en) <= 300),
  constraint items_desc_hi_len check (description_hi is null or char_length(description_hi) <= 300),
  constraint items_price check (price_paise between 0 and 10000000),
  constraint items_diet check (diet in ('veg','nonveg','egg','jain')),
  constraint items_spice check (spice between 0 and 3),
  -- uploads must live in the restaurant's own storage folder, with no path tricks
  constraint items_image_path check (image_path is null or (
    image_path like restaurant_id::text || '/%' and image_path !~ '\.\.' and char_length(image_path) <= 200))
);
create index if not exists items_category_idx on public.items (category_id);
create index if not exists items_restaurant_idx on public.items (restaurant_id, category_id, sort_order);

create table if not exists public.dining_tables (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  label         text not null,
  -- 2 x 122 random bits (two UUIDv4, hyphens removed) = comfortably above 128 bits of entropy
  qr_token      text not null unique
                default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint dining_tables_label_len check (char_length(label) between 1 and 20),
  constraint dining_tables_token_format check (qr_token ~ '^[0-9a-f]{64}$'),
  constraint dining_tables_label_uq unique (restaurant_id, label),
  constraint dining_tables_id_restaurant_uq unique (id, restaurant_id)
);

create table if not exists public.table_sessions (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants (id) on delete cascade,
  table_id          uuid not null,
  opened_at         timestamptz not null default now(),
  closed_at         timestamptz,
  closed_by         uuid references auth.users (id) on delete set null,
  close_reason      text,
  pay_mode          text,
  bill_requested_at timestamptz,
  final_total_paise int,
  constraint sessions_table_fk foreign key (table_id, restaurant_id)
    references public.dining_tables (id, restaurant_id) ,
  constraint sessions_id_restaurant_uq unique (id, restaurant_id),
  constraint sessions_pay_mode check (pay_mode is null or pay_mode in ('cash','upi','card')),
  constraint sessions_close_reason check (close_reason is null or close_reason in ('paid','forced')),
  constraint sessions_closed_order check (closed_at is null or closed_at >= opened_at),
  constraint sessions_closed_fields check ((closed_at is null) = (close_reason is null)),
  constraint sessions_total check (final_total_paise is null or final_total_paise >= 0)
);
-- exactly one open session per table
create unique index if not exists sessions_one_open_per_table on public.table_sessions (table_id) where closed_at is null;
create index if not exists sessions_restaurant_open_idx on public.table_sessions (restaurant_id, closed_at);
create index if not exists sessions_table_idx on public.table_sessions (table_id);

create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants (id) on delete cascade,
  session_id      uuid not null,
  table_id        uuid not null,
  order_no        bigint not null,
  status          text not null default 'placed',
  note            text,
  total_paise     int not null,
  idempotency_key text not null,
  created_at      timestamptz not null default now(),
  preparing_at    timestamptz,
  ready_at        timestamptz,
  served_at       timestamptz,
  cancelled_at    timestamptz,
  cancel_reason   text,
  status_by       uuid references auth.users (id) on delete set null,
  constraint orders_session_fk foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete cascade,
  constraint orders_table_fk foreign key (table_id, restaurant_id)
    references public.dining_tables (id, restaurant_id) ,
  constraint orders_id_restaurant_uq unique (id, restaurant_id),
  constraint orders_no_uq unique (restaurant_id, order_no),
  constraint orders_idem_uq unique (session_id, idempotency_key),
  constraint orders_status check (status in ('placed','preparing','ready','served','cancelled')),
  constraint orders_note_len check (note is null or char_length(note) <= 200),
  constraint orders_total check (total_paise between 0 and 100000000),
  constraint orders_idem_len check (char_length(idempotency_key) between 8 and 64),
  constraint orders_cancel_reason check (status <> 'cancelled' or (cancel_reason is not null and char_length(cancel_reason) between 1 and 200))
);
create index if not exists orders_board_idx on public.orders (restaurant_id, status, created_at);
create index if not exists orders_session_idx on public.orders (session_id, created_at);
create index if not exists orders_table_idx on public.orders (table_id, created_at);

create table if not exists public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null,
  restaurant_id      uuid not null references public.restaurants (id) on delete cascade,
  item_id            uuid,
  name_en_snapshot   text not null,
  name_hi_snapshot   text,
  unit_price_paise   int not null,
  qty                int not null,
  note               text,
  constraint order_items_order_fk foreign key (order_id, restaurant_id)
    references public.orders (id, restaurant_id) on delete cascade,
  constraint order_items_item_fk foreign key (item_id, restaurant_id)
    references public.items (id, restaurant_id) on delete set null (item_id),
  constraint order_items_qty check (qty between 1 and 20),
  constraint order_items_price check (unit_price_paise between 0 and 10000000),
  constraint order_items_note_len check (note is null or char_length(note) <= 100),
  constraint order_items_name_len check (char_length(name_en_snapshot) between 1 and 80)
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_item_idx on public.order_items (item_id);
create index if not exists order_items_restaurant_idx on public.order_items (restaurant_id);

create table if not exists public.service_requests (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  table_id      uuid not null,
  session_id    uuid not null,
  type          text not null,
  reason        text,
  pay_mode      text,
  status        text not null default 'open',
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references auth.users (id) on delete set null,
  constraint requests_table_fk foreign key (table_id, restaurant_id)
    references public.dining_tables (id, restaurant_id) ,
  constraint requests_session_fk foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete cascade,
  constraint requests_type check (type in ('waiter','bill')),
  constraint requests_reason check (reason is null or reason in ('water','cutlery','cleaning','help','other')),
  constraint requests_pay_mode check (pay_mode is null or pay_mode in ('cash','upi','card')),
  constraint requests_status check (status in ('open','done')),
  constraint requests_shape check (
    (type = 'bill'   and pay_mode is not null and reason is null) or
    (type = 'waiter' and pay_mode is null and reason is not null))
);
-- at most one open request per session per type: a second tap is idempotent
create unique index if not exists requests_one_open_per_type on public.service_requests (session_id, type) where status = 'open';
create index if not exists requests_board_idx on public.service_requests (restaurant_id, status, created_at);
create index if not exists requests_table_idx on public.service_requests (table_id);
create index if not exists requests_session_idx on public.service_requests (session_id);

create table if not exists public.review_clicks (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  session_id    uuid not null,
  created_at    timestamptz not null default now(),
  constraint review_clicks_session_fk foreign key (session_id, restaurant_id)
    references public.table_sessions (id, restaurant_id) on delete cascade
);
create index if not exists review_clicks_restaurant_idx on public.review_clicks (restaurant_id, created_at);
create index if not exists review_clicks_session_idx on public.review_clicks (session_id);

-- Fixed-window counters for rate limiting. `key` is already a salted hash built by the app.
create table if not exists public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  count        int not null default 0,
  constraint rate_limits_key_len check (char_length(key) <= 200)
);
create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

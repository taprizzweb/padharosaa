-- 0065_billing_tables
-- Front office billing, step 1: the data. A hotel sets its OWN taxes and charges (nothing is fixed in code): tax rates, charge categories,
-- a room tax rule by nightly rate, and extra charges (service charge, a fee per night...). A guest is checked in as a "stay" with a rate; the
-- folio is the stay's bill (room rent + room service orders + charges added at the desk), payments are recorded against the stay, and an
-- invoice is a frozen copy of the folio with a gapless number. Amounts are whole paise; tax rates are basis points (500 = 5%).
-- Every table has row level security and NO policy: the app reaches them only through the functions in 0066 and 0067.
-- Idempotent. Rollback: drop the tables below (children first) and the added columns.
alter table public.hotel_settings add column if not exists legal_name text check (legal_name is null or char_length(legal_name) between 1 and 120);
alter table public.hotel_settings add column if not exists gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');
alter table public.hotel_settings add column if not exists bill_address text check (bill_address is null or char_length(bill_address) <= 300);
alter table public.hotel_settings add column if not exists invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,8}$');
alter table public.hotel_settings add column if not exists invoice_terms text check (invoice_terms is null or char_length(invoice_terms) <= 400);
alter table public.hotel_settings add column if not exists round_off boolean not null default true;

create table if not exists public.room_types (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 40),
  rate_paise    int not null check (rate_paise between 0 and 10000000),
  max_guests    int not null default 2 check (max_guests between 1 and 20),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, name),
  unique (id, restaurant_id)
);
alter table public.room_types enable row level security;
alter table public.rooms add column if not exists room_type_id uuid references public.room_types (id) on delete set null;

create table if not exists public.tax_rates (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 40),
  rate_bp       int not null check (rate_bp between 0 and 10000),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, name),
  unique (id, restaurant_id)
);
alter table public.tax_rates enable row level security;

-- what a line on the bill is: the room, food, or anything else the hotel names. Each points at ONE tax rate (or none).
create table if not exists public.charge_categories (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  kind          text not null check (kind in ('room','food','other')),
  name          text not null check (char_length(name) between 1 and 40),
  sac           text check (sac is null or sac ~ '^[0-9]{4,8}$'),
  tax_rate_id   uuid references public.tax_rates (id) on delete set null,
  active        boolean not null default true,
  sort          int not null default 100,
  created_at    timestamptz not null default now(),
  unique (restaurant_id, name),
  unique (id, restaurant_id)
);
create unique index if not exists charge_categories_one_kind_idx on public.charge_categories (restaurant_id, kind) where kind in ('room','food');
alter table public.charge_categories enable row level security;

-- the room's tax can depend on the nightly rate: the first active slab whose limit is not below the rate (no limit = everything above)
create table if not exists public.room_tax_slabs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  up_to_paise   int check (up_to_paise is null or up_to_paise > 0),
  tax_rate_id   uuid not null references public.tax_rates (id) on delete cascade,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table public.room_tax_slabs enable row level security;

-- extra columns on every bill: percent of the room or food (service charge), a fixed fee per night, or a flat fee
create table if not exists public.bill_extras (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 40),
  mode          text not null check (mode in ('percent','per_night','flat')),
  value         int not null check (value between 0 and 10000000),
  applies_to    text not null default 'all' check (applies_to in ('room','food','all')),
  tax_rate_id   uuid references public.tax_rates (id) on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  check (mode <> 'percent' or value <= 10000),
  unique (restaurant_id, name)
);
alter table public.bill_extras enable row level security;

create table if not exists public.stays (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants (id) on delete cascade,
  room_id        uuid not null,
  guest_name     text not null check (char_length(guest_name) between 2 and 80),
  mobile         text check (mobile is null or mobile ~ '^[0-9]{10,15}$'),
  id_type        text check (id_type is null or id_type in ('aadhaar','passport','driving_licence','voter_id','other')),
  id_last4       text check (id_last4 is null or id_last4 ~ '^[A-Za-z0-9]{1,4}$'),  -- only the last characters are kept, never a full ID number
  adults         int not null default 1 check (adults between 1 and 20),
  company_name   text check (company_name is null or char_length(company_name) between 1 and 120),
  company_gstin  text check (company_gstin is null or company_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  address        text check (address is null or char_length(address) <= 300),
  inter_state    boolean not null default false,
  rate_paise     int not null check (rate_paise between 0 and 10000000),
  check_in_at    timestamptz not null default now(),
  check_out_on   date not null,
  checked_out_at timestamptz,
  status         text not null default 'in_house' check (status in ('in_house','checked_out')),
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint stays_room_fk foreign key (room_id, restaurant_id) references public.rooms (id, restaurant_id),
  unique (id, restaurant_id)
);
create unique index if not exists stays_one_in_house_idx on public.stays (room_id) where status = 'in_house';
create index if not exists stays_hotel_idx on public.stays (restaurant_id, status, check_in_at desc);
alter table public.stays enable row level security;

create table if not exists public.folio_lines (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  stay_id       uuid not null references public.stays (id) on delete cascade,
  category_id   uuid not null references public.charge_categories (id),
  description   text not null check (char_length(description) between 1 and 120),
  qty           int not null default 1 check (qty between 1 and 99),
  unit_paise    int not null check (unit_paise between -10000000 and 10000000 and unit_paise <> 0),
  posted_at     timestamptz not null default now(),
  created_by    uuid references auth.users (id) on delete set null,
  voided_at     timestamptz,
  voided_by     uuid references auth.users (id) on delete set null,
  void_reason   text check (void_reason is null or char_length(void_reason) between 1 and 200),
  check (voided_at is null or void_reason is not null)
);
create index if not exists folio_lines_stay_idx on public.folio_lines (stay_id, posted_at);
alter table public.folio_lines enable row level security;

create table if not exists public.stay_payments (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  stay_id       uuid not null references public.stays (id) on delete cascade,
  kind          text not null check (kind in ('advance','payment','refund')),
  mode          text not null check (mode in ('cash','card','upi','bank','company')),
  amount_paise  int not null check (amount_paise between 1 and 100000000),
  ref           text check (ref is null or char_length(ref) <= 60),
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists stay_payments_stay_idx on public.stay_payments (stay_id, created_at);
alter table public.stay_payments enable row level security;

create table if not exists public.invoice_counters (
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  fy            text not null check (fy ~ '^[0-9]{4}-[0-9]{2}$'),
  last_no       int not null default 0,
  primary key (restaurant_id, fy)
);
alter table public.invoice_counters enable row level security;

create table if not exists public.invoices (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  stay_id       uuid not null unique references public.stays (id) on delete cascade,
  number        text not null,
  issued_at     timestamptz not null default now(),
  issued_by     uuid references auth.users (id) on delete set null,
  total_paise   bigint not null,
  snapshot      jsonb not null,
  unique (restaurant_id, number)
);
alter table public.invoices enable row level security;

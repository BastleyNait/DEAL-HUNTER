-- Cazador de ofertas de laptops (Revolt) — esquema inicial

create table if not exists public.ebay_oauth_token (
  id int primary key default 1,
  access_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint ebay_oauth_token_single_row check (id = 1)
);

create table if not exists public.seen_listings (
  item_id text primary key,
  title text not null,
  price numeric,
  currency text,
  condition text,
  cpu_match text,
  qualified boolean not null default false,
  reject_reason text,
  url text,
  image_url text,
  first_seen_at timestamptz not null default now(),
  notified_at timestamptz
);

create index if not exists seen_listings_qualified_idx on public.seen_listings (qualified, first_seen_at desc);

create table if not exists public.hunt_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_scanned int not null default 0,
  candidates_checked int not null default 0,
  items_qualified int not null default 0,
  error text
);

alter table public.ebay_oauth_token enable row level security;
alter table public.seen_listings enable row level security;
alter table public.hunt_runs enable row level security;

-- Solo el service role (usado por la Edge Function) puede leer/escribir.
-- No se crean policies para anon/authenticated a propósito: nadie más debe tocar estas tablas.

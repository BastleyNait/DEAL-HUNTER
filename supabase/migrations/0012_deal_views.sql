-- Estado de "visto" sincronizado entre dispositivos.
--
-- El dashboard va desplegado sin login, así que la clave anon necesita poder
-- escribir acá. Por eso el permiso se acota a esta tabla y nada más: las
-- ofertas (seen_listings) y la config (search_config) siguen sin ninguna
-- policy para anon, o sea que desde el navegador no se pueden leer ni tocar.
--
-- La foreign key es la otra defensa: solo se pueden marcar item_ids que el
-- cazador realmente encontró, así nadie puede llenar la tabla con basura.

create table if not exists public.deal_views (
  item_id text primary key references public.seen_listings (item_id) on delete cascade,
  seen_at timestamptz not null default now()
);

alter table public.deal_views enable row level security;

drop policy if exists "deal_views son legibles" on public.deal_views;
create policy "deal_views son legibles"
  on public.deal_views for select
  to anon, authenticated
  using (true);

drop policy if exists "marcar una oferta como vista" on public.deal_views;
create policy "marcar una oferta como vista"
  on public.deal_views for insert
  to anon, authenticated
  with check (true);

drop policy if exists "desmarcar una oferta" on public.deal_views;
create policy "desmarcar una oferta"
  on public.deal_views for delete
  to anon, authenticated
  using (true);

grant select, insert, delete on public.deal_views to anon, authenticated;

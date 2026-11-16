-- Ofertas descartadas desde el dashboard ("✕"): no aparecen más en ninguna
-- vista, en ningún dispositivo, salvo en la pestaña "Descartadas" para
-- restaurarlas. Mismo esquema que deal_views (0012): el dashboard no tiene
-- login, así que la clave anon puede leer, marcar y desmarcar solo acá, y la
-- foreign key impide guardar item_ids que el cazador no encontró.

create table if not exists public.deal_dismissals (
  item_id text primary key references public.seen_listings (item_id) on delete cascade,
  dismissed_at timestamptz not null default now()
);

alter table public.deal_dismissals enable row level security;

drop policy if exists "deal_dismissals son legibles" on public.deal_dismissals;
create policy "deal_dismissals son legibles"
  on public.deal_dismissals for select
  to anon, authenticated
  using (true);

drop policy if exists "descartar una oferta" on public.deal_dismissals;
create policy "descartar una oferta"
  on public.deal_dismissals for insert
  to anon, authenticated
  with check (true);

drop policy if exists "restaurar una oferta" on public.deal_dismissals;
create policy "restaurar una oferta"
  on public.deal_dismissals for delete
  to anon, authenticated
  using (true);

grant select, insert, delete on public.deal_dismissals to anon, authenticated;

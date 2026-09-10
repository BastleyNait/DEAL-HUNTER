-- Puntaje de ofertas + vista pública de solo lectura para el dashboard web.

alter table public.seen_listings
  add column if not exists score numeric,
  add column if not exists is_great_deal boolean not null default false;

create index if not exists seen_listings_score_idx
  on public.seen_listings (qualified, score desc, first_seen_at desc);

-- Vista de solo lectura: expone únicamente lo necesario para el dashboard
-- (nada de columnas internas como reject_reason) y solo ítems que calificaron.
-- Al no tener `security_invoker`, corre con los permisos del owner (bypassa el
-- RLS de seen_listings) — es el patrón estándar de Supabase para exponer una
-- porción pública de una tabla protegida.
create or replace view public.deals_public as
select
  item_id,
  title,
  price,
  currency,
  condition,
  cpu_match,
  score,
  is_great_deal,
  url,
  image_url,
  first_seen_at
from public.seen_listings
where qualified = true;

grant select on public.deals_public to anon, authenticated;

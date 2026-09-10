-- Datos para la vista de detalle del dashboard: fotos adicionales, la
-- descripción del vendedor y los item specifics. Ya los traíamos de eBay para
-- evaluar las reglas, pero se descartaban después de puntuar.

alter table public.seen_listings
  add column if not exists seller_description text,
  add column if not exists aspects jsonb not null default '[]'::jsonb,
  add column if not exists additional_images jsonb not null default '[]'::jsonb;

drop view if exists public.deals_public;

create view public.deals_public as
select
  item_id,
  title,
  price,
  currency,
  condition,
  cpu_match,
  score,
  is_great_deal,
  has_description,
  has_battery_info,
  battery_grade,
  is_auction,
  has_best_offer,
  end_date,
  seller_username,
  seller_feedback_score,
  seller_feedback_percentage,
  seller_description,
  aspects,
  additional_images,
  url,
  image_url,
  first_seen_at
from public.seen_listings
where qualified = true;

grant select on public.deals_public to anon, authenticated;

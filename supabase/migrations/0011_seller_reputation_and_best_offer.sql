-- Reputación del vendedor y formato de compra.
--
-- Medido contra la API real: eBay devuelve seller {username, feedbackScore,
-- feedbackPercentage} en todos los resultados de búsqueda, así que el filtro
-- corre en el pre-descarte y no gasta llamadas de detalle. Con el umbral
-- pedido (>= 1000 ventas y >= 95%) se descarta ~23% de los resultados.

update public.search_config
set config = config || jsonb_build_object(
  'minSellerFeedbackScore', 1000,
  'minSellerFeedbackPercentage', 95
)
where id = 1;

alter table public.seen_listings
  add column if not exists has_best_offer boolean not null default false,
  add column if not exists seller_username text,
  add column if not exists seller_feedback_score int,
  add column if not exists seller_feedback_percentage numeric;

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
  url,
  image_url,
  first_seen_at
from public.seen_listings
where qualified = true;

grant select on public.deals_public to anon, authenticated;

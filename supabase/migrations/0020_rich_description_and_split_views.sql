-- Descripción con formato para el modal, y separación de la vista pesada.
--
-- La descripción con HTML puede pesar hasta 20k por publicación. Con ~300
-- ofertas activas y el dashboard releyendo la lista cada 60s, meterla en
-- deals_public haría una carga de varios MB por refresco. Peor: deals_public
-- ya venía cargando la descripción en texto, los item specifics y las fotos
-- adicionales, que tampoco se usan en la lista.
--
-- Entonces: deals_public queda con lo que la lista realmente muestra, y el
-- detalle se pide por ítem cuando se abre el modal.

alter table public.seen_listings
  add column if not exists seller_description_html text;

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
  is_priority,
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

-- Solo lo pesado, que se pide de a un ítem por vez.
create or replace view public.deal_details_public as
select
  item_id,
  seller_description,
  seller_description_html,
  aspects,
  additional_images
from public.seen_listings
where qualified = true;

grant select on public.deals_public to anon, authenticated;
grant select on public.deal_details_public to anon, authenticated;

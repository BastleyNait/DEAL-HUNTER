-- 1) Config: incluir subastas, exigir envío a EE.UU. (casillero en Doral, FL —
--    no importa si el vendedor no envía a Perú), y la excepción de precio para
--    reacondicionados con Best Offer (listado hasta $225, negociable a <= $200).
update public.search_config
set config = config || jsonb_build_object(
  'includeAuctions', true,
  'deliveryCountry', 'US',
  'refurbishedExceptionMaxPrice', 225,
  'refurbishedConditionIds', jsonb_build_array(2000, 2500)
)
where id = 1;

-- 2) Grado de batería por letra (ej. "Battery Grade C") — no descarta, se
--    guarda para marcar "revisar a mano" en el dashboard (grados C/D/F).
alter table public.seen_listings
  add column if not exists battery_grade text,
  add column if not exists is_auction boolean not null default false;

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
  url,
  image_url,
  first_seen_at
from public.seen_listings
where qualified = true;

grant select on public.deals_public to anon, authenticated;

-- Cierre de subasta: sin la hora de cierre una subasta es inaccionable (no se
-- sabe si quedan 3 horas o 5 días). Lo expone la Browse API como itemEndDate.

alter table public.seen_listings
  add column if not exists end_date timestamptz;

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
  end_date,
  url,
  image_url,
  first_seen_at
from public.seen_listings
where qualified = true;

grant select on public.deals_public to anon, authenticated;

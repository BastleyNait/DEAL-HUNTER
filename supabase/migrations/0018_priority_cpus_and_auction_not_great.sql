-- 1) CPUs prioritarias: i5 12va e i7 11va encabezan el dashboard y se avisan
--    por Telegram aunque no lleguen a "ofertaza".
--
-- 2) Una subasta ya no puede ser "ofertaza". El precio que se ve es la puja
--    actual, no lo que se termina pagando, así que no hay forma de afirmar que
--    sea una ganga. El puntaje se sigue calculando para poder ordenarlas.

update public.search_config
set config = config || jsonb_build_object(
  'priorityCpus', jsonb_build_array('Intel i5 12th gen', 'Intel i7 11th gen')
)
where id = 1;

alter table public.seen_listings
  add column if not exists is_priority boolean not null default false;

update public.seen_listings
set is_priority = cpu_match in ('Intel i5 12th gen', 'Intel i7 11th gen');

update public.seen_listings
set is_great_deal = false
where is_auction = true and is_great_deal = true;

create index if not exists seen_listings_priority_idx
  on public.seen_listings (qualified, is_priority desc, score desc);

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
  seller_description,
  aspects,
  additional_images,
  url,
  image_url,
  first_seen_at
from public.seen_listings
where qualified = true;

grant select on public.deals_public to anon, authenticated;

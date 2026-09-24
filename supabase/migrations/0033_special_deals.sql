-- Nuevo tipo de alerta: OFERTA ESPECIAL.
--
-- Modelos poco conocidos pero de lo mejor en su rango de precio según lo que
-- ya se compró y se probó: arranca con la serie Portégé de Dynabook (X30L,
-- X30W, X40, X50 en generaciones J y K). Dos de las compras reales fueron una
-- X30W-J ($153.78) y una X30L-J ($165).
--
-- - special_label: qué modelo especial matcheó (null si ninguno). Lo escribe
--   HuntService al guardar; acá solo se agrega la columna.
-- - Se avisan aunque no lleguen a notifyScoreAbove: el puntaje castiga los
--   8GB, y la X30W-J que se compró era de 8GB.
-- - specialSearchProfiles corre en todas las corridas, fuera de la rotación:
--   hay ~70 Dynabook bajo $225 en todo eBay US y se venden rápido.
--
-- Los valores de config salen de default-config.ts (generado, no tipeado a
-- mano), así los patrones regex quedan idénticos en código y en la base.

alter table public.seen_listings
  add column if not exists special_label text;

-- El dashboard necesita la marca. Columna nueva al final: create or replace
-- view solo permite agregar.
create or replace view public.deals_public as
select item_id, title, price, currency, condition, cpu_match, score,
       is_great_deal, is_priority, has_description, has_battery_info,
       battery_grade, is_auction, has_best_offer, end_date, seller_username,
       seller_feedback_score, seller_feedback_percentage, url, image_url,
       first_seen_at, bid_count, price_checked_at, special_label
  from public.seen_listings
 where qualified = true
   and is_available;

grant select on public.deals_public to anon, authenticated;

-- Refresco de precio/disponibilidad: las subastas especiales entran al tramo
-- de "por avisar" sin umbral de puntaje (igual que el aviso), y en compra
-- directa las especiales se verifican primero — se venden rápido y es lo que
-- más importa saber si sigue disponible.
create or replace function public.find_listings_to_refresh(
  p_limit integer,
  p_stale_minutes integer,
  p_alert_window_minutes integer,
  p_alert_max_price numeric,
  p_score_above numeric,
  p_excluded_sellers text[]
)
returns table (item_id text)
language sql
stable
as $$
  with alert as (
    select s.item_id, 0 as tier, row_number() over (order by s.end_date) as rn
      from public.seen_listings s
     where s.qualified and s.is_available and s.is_auction
       and s.auction_alerted_at is null
       and s.end_date > now()
       and s.end_date <= now() + make_interval(mins => p_alert_window_minutes)
       and s.price <= p_alert_max_price
       and (s.score > p_score_above or s.special_label is not null)
       and (s.seller_username is null or not (s.seller_username = any (p_excluded_sellers)))
       and (s.price_checked_at is null or s.price_checked_at < now() - interval '5 minutes')
  ), buy_now as (
    select s.item_id, 1 as tier,
           row_number() over (
             order by (s.special_label is not null) desc, s.is_priority desc, s.score desc nulls last
           ) as rn
      from public.seen_listings s
     where s.qualified and s.is_available and not s.is_auction
       and (s.price_checked_at is null or s.price_checked_at < now() - make_interval(mins => p_stale_minutes))
  ), auctions as (
    select s.item_id, 1 as tier, row_number() over (order by s.end_date) as rn
      from public.seen_listings s
     where s.qualified and s.is_available and s.is_auction
       and s.end_date > now()
       and s.item_id not in (select a.item_id from alert a)
       and (s.price_checked_at is null or s.price_checked_at < now() - make_interval(mins => p_stale_minutes))
  )
  select x.item_id
    from (select * from alert union all select * from buy_now union all select * from auctions) x
   order by x.tier, x.rn
   limit p_limit;
$$;

update public.search_config
   set config = config || jsonb_build_object(
         'specialDeals', '[
  {
    "label": "Dynabook Portégé serie J",
    "pattern": "^(?=.*(?:dynabook|port[eé]g[eé]|toshiba)).*\\bx(?:30[lw]|40|50)[\\s-]?j\\b",
    "flags": "i",
    "impliedIntelGeneration": 11
  },
  {
    "label": "Dynabook Portégé serie K",
    "pattern": "^(?=.*(?:dynabook|port[eé]g[eé]|toshiba)).*\\bx(?:30[lw]|40|50)[\\s-]?k\\b",
    "flags": "i",
    "impliedIntelGeneration": 12
  }
]'::jsonb,
         'specialSearchProfiles', '[
  {
    "query": "dynabook",
    "sort": "newlyListed",
    "maxPages": 1
  },
  {
    "query": "portege",
    "sort": "newlyListed",
    "maxPages": 1
  }
]'::jsonb
       )
 where id = 1;

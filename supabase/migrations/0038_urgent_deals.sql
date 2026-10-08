-- Nuevo tipo de aviso: OFERTA URGENTE.
--
-- La combinación que se compra sin pensarlo: 16GB de RAM o más, SSD de 512GB o
-- más, i5 12.ª / i7 11.ª (o su equivalente Ryzen), menos de $250 en compra
-- directa y sin que la publicación hable de problemas. Encabeza el mensaje de
-- Telegram con 💰 y le gana al resto en el orden de los avisos.
--
-- - is_urgent lo escribe HuntService al guardar. Los criterios (RAM, disco,
--   CPU, tope de precio, filtro de problemas) viven en search_config
--   (urgentDeal) y salen de default-config.ts; no hace falta tocar la fila de
--   config: si no tiene la clave, SupabaseConfigProvider usa la del código.
-- - Puede pasar de maxPriceUsd ($200) hasta $250, por eso hay publicaciones
--   guardadas con precio mayor al presupuesto: solo si son urgentes.
-- - No se salta el umbral de puntaje de los avisos: una Latitude con la
--   combinación completa igual avisa solo si supera el puntaje, como antes.

alter table public.seen_listings
  add column if not exists is_urgent boolean not null default false;

-- El dashboard necesita la marca. Columna nueva al final: create or replace
-- view solo permite agregar.
create or replace view public.deals_public as
select item_id, title, price, currency, condition, cpu_match, score,
       is_great_deal, is_priority, has_description, has_battery_info,
       battery_grade, is_auction, has_best_offer, end_date, seller_username,
       seller_feedback_score, seller_feedback_percentage, url, image_url,
       first_seen_at, bid_count, price_checked_at, special_label, special_demoted,
       is_urgent
  from public.seen_listings
 where qualified = true
   and is_available;

grant select on public.deals_public to anon, authenticated;

-- Refresco: las urgentes (compra directa) se verifican primero, igual que las
-- especiales. Su precio es el dato que decide la compra.
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
       and (s.score > p_score_above or (s.special_label is not null and not s.special_demoted))
       and (s.seller_username is null or not (s.seller_username = any (p_excluded_sellers)))
       and (s.price_checked_at is null or s.price_checked_at < now() - interval '5 minutes')
  ), buy_now as (
    select s.item_id, 1 as tier,
           row_number() over (
             order by s.is_urgent desc,
                      (s.special_label is not null and not s.special_demoted) desc,
                      s.is_priority desc, s.score desc nulls last
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

-- Ryzen con "PRO" en el nombre ("Ryzen 7 PRO 5850U"): así se venden casi todas
-- las ThinkPad y EliteBook con Ryzen, y los patrones no los reconocían. Se
-- actualiza solo el patrón de cada Ryzen; los tiers de la fila no se tocan.
-- Los patrones salen de default-config.ts (generados, no tipeados a mano).
update public.search_config
   set config = jsonb_set(config, '{cpuPatterns}', (
     select jsonb_agg(
              case when v.label is not null
                   then jsonb_set(t.e, '{pattern}', to_jsonb(v.pattern::text))
                   else t.e end
              order by t.o)
       from jsonb_array_elements(config->'cpuPatterns') with ordinality as t(e, o)
       left join (values
       ($p$AMD Ryzen 7 7000$p$, $p$\b(?:ryzen[\s®™_-]*7(?:[\s-]*pro)?|r7)[\s-]?7\d{3}[a-z]{0,2}\b$p$),
       ($p$AMD Ryzen 5 7000$p$, $p$\b(?:ryzen[\s®™_-]*5(?:[\s-]*pro)?|r5)[\s-]?7\d{3}[a-z]{0,2}\b$p$),
       ($p$AMD Ryzen 7 5000$p$, $p$\b(?:ryzen[\s®™_-]*7(?:[\s-]*pro)?|r7)[\s-]?5\d{3}[a-z]{0,2}\b$p$),
       ($p$AMD Ryzen 7 4000$p$, $p$\b(?:ryzen[\s®™_-]*7(?:[\s-]*pro)?|r7)[\s-]?4\d{3}[a-z]{0,2}\b|(?=.*\bryzen\b)(?=.*\b4000\b)$p$),
       ($p$AMD Ryzen 5 5000$p$, $p$\b(?:ryzen[\s®™_-]*5(?:[\s-]*pro)?|r5)[\s-]?5\d{3}[a-z]{0,2}\b|(?=.*\bryzen\b)(?=.*\b5000\b)$p$)
       ) as v(label, pattern) on v.label = t.e->>'label'
   ))
 where id = 1;

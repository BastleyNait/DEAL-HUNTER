-- Las Dell 2 en 1 bajan de prioridad.
--
-- Siguen marcadas como 2 en 1 y se ven en su pestaña, pero llegan seguido
-- rayadas o rotas, así que ya no reciben el trato de oferta especial:
--   - no se saltan el umbral de puntaje del aviso (avisan solo si lo superan),
--   - no encabezan el orden, ni en Telegram ni en el dashboard,
--   - no se anuncian como "OFERTA 2 EN 1".
-- Es la misma decisión que ya pesa a las Latitude en el escalafón de reventa
-- y les resta 10 puntos.
--
-- special_demoted lo escribe HuntService al guardar; el patrón vive en
-- search_config (specialDeals[2].demotePattern) y sale de default-config.ts.

alter table public.seen_listings
  add column if not exists special_demoted boolean not null default false;

-- Lo ya guardado. \m y \M son los límites de palabra de Postgres, el
-- equivalente del \b del patrón de la config.
update public.seen_listings
   set special_demoted = (title ~* '\m(?:dell|latitude|inspiron|xps)\M')
 where special_label is not null;

update public.search_config
   set config = jsonb_set(
         config,
         '{specialDeals,2,demotePattern}',
         '"\\b(?:dell|latitude|inspiron|xps)\\b"'::jsonb
       )
 where id = 1;

-- El dashboard necesita saber cuáles ordenar al final. Columna nueva al
-- final: create or replace view solo permite agregar.
create or replace view public.deals_public as
select item_id, title, price, currency, condition, cpu_match, score,
       is_great_deal, is_priority, has_description, has_battery_info,
       battery_grade, is_auction, has_best_offer, end_date, seller_username,
       seller_feedback_score, seller_feedback_percentage, url, image_url,
       first_seen_at, bid_count, price_checked_at, special_label, special_demoted
  from public.seen_listings
 where qualified = true
   and is_available;

grant select on public.deals_public to anon, authenticated;

-- Refresco de precio/disponibilidad: mismo criterio que el aviso. Una subasta
-- de prioridad baja entra al tramo de "por avisar" solo si supera el umbral,
-- y en compra directa las de prioridad baja no se verifican primero.
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
             order by (s.special_label is not null and not s.special_demoted) desc,
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

-- Precio y disponibilidad al día.
--
-- Hasta acá cada publicación se consultaba una sola vez, al encontrarla. El
-- dashboard mostraba el precio de ese momento para siempre, y seguía listando
-- equipos que ya se habían vendido. En subastas era peor: una HP ZBook guardada
-- a $92 iba en $215 con 18 pujas, y el aviso de "menos de $150" salía igual
-- porque comparaba contra el precio viejo.
--
-- Ahora el cazador refresca publicaciones en cada corrida (ver
-- HuntService.refreshListings) y guarda el resultado acá.

alter table public.seen_listings
  add column if not exists is_available boolean not null default true,
  add column if not exists unavailable_at timestamptz,
  add column if not exists bid_count integer,
  add column if not exists price_checked_at timestamptz;

create index if not exists seen_listings_refresh_idx
  on public.seen_listings (price_checked_at nulls first)
  where qualified and is_available;

-- ---------------------------------------------------------------------------
-- El dashboard deja de mostrar lo vendido y expone cuándo se verificó el precio.
-- Las columnas nuevas van al final: create or replace view solo permite agregar.
-- ---------------------------------------------------------------------------
create or replace view public.deals_public as
select item_id, title, price, currency, condition, cpu_match, score,
       is_great_deal, is_priority, has_description, has_battery_info,
       battery_grade, is_auction, has_best_offer, end_date, seller_username,
       seller_feedback_score, seller_feedback_percentage, url, image_url,
       first_seen_at, bid_count, price_checked_at
  from public.seen_listings
 where qualified = true
   and is_available;

grant select on public.deals_public to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Aplicar el estado consultado a eBay
-- ---------------------------------------------------------------------------
-- Recibe un arreglo JSON de {item_id, available, price, bid_count, end_date}.
-- Va por RPC, o sea por POST: una lista larga no choca con el límite de largo
-- de URL que ya rompió filterUnseen.
--
-- Un precio nulo no pisa el guardado, porque una publicación vendida o borrada
-- no trae precio y el último conocido sigue siendo útil de referencia. Solo
-- toca ofertas calificadas: son las únicas que alguien mira.
create or replace function public.apply_listing_status(p_rows jsonb)
returns integer
language sql
volatile
as $$
  with incoming as (
    select *
      from jsonb_to_recordset(p_rows)
        as r(item_id text, available boolean, price numeric, bid_count integer, end_date timestamptz)
  ), updated as (
    update public.seen_listings s
       set is_available = r.available,
           unavailable_at = case when r.available then null else coalesce(s.unavailable_at, now()) end,
           price = coalesce(r.price, s.price),
           bid_count = coalesce(r.bid_count, s.bid_count),
           end_date = coalesce(r.end_date, s.end_date),
           price_checked_at = now()
      from incoming r
     where s.item_id = r.item_id
       and s.qualified
    returning 1
  )
  select count(*)::integer from updated;
$$;

-- ---------------------------------------------------------------------------
-- Qué refrescar con el presupuesto de la corrida
-- ---------------------------------------------------------------------------
-- La cuota de la Browse API es de 5.000 llamadas diarias y no hay consulta en
-- lote habilitada para esta cuenta, así que cada publicación cuesta una
-- llamada. Se reparte en dos niveles:
--
--  0. Subastas que se van a avisar en esta corrida o la siguiente. Van
--     primero siempre: el aviso tiene que comparar contra la puja actual.
--  1. Lo que ves en el dashboard, alternando: compras directas por prioridad y
--     puntaje, y subastas abiertas por cierre más cercano. Solo lo que no se
--     verificó en los últimos p_stale_minutes.
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
       and s.score > p_score_above
       and (s.seller_username is null or not (s.seller_username = any (p_excluded_sellers)))
       and (s.price_checked_at is null or s.price_checked_at < now() - interval '5 minutes')
  ), buy_now as (
    select s.item_id, 1 as tier,
           row_number() over (order by s.is_priority desc, s.score desc nulls last) as rn
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

-- Presupuesto editable sin redeployar.
update public.search_config
   set config = config || jsonb_build_object(
         'refreshCallsPerRun', 20,
         'refreshStaleMinutes', 120,
         'refreshAlertWindowMinutes', 40
       )
 where id = 1;

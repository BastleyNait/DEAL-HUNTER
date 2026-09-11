-- Las subastas se avisaban al encontrarlas, así que llegaban avisos de cosas
-- que cerraban recién en 5 días: ruido, porque hasta entonces el precio se
-- mueve mucho. Ahora se avisan cuando entran en su último tramo (24h por
-- defecto) y solo si la puja actual deja margen para ofertar (<= $150).
--
-- Eso necesita una pasada aparte sobre lo ya guardado: cada publicación se
-- evalúa una sola vez, así que una subasta descubierta con días de
-- anticipación nunca volvería a mirarse. La columna marca cuáles ya se
-- avisaron, para no repetir el aviso en cada corrida.

alter table public.seen_listings
  add column if not exists auction_alerted_at timestamptz;

create index if not exists seen_listings_auction_alert_idx
  on public.seen_listings (end_date)
  where qualified = true and is_auction = true and auction_alerted_at is null;

update public.search_config
set config = config || jsonb_build_object(
  'auctionAlertMaxHoursLeft', 24,
  'auctionAlertMaxPrice', 150,
  'maxAuctionAlertsPerRun', 6
)
where id = 1;

-- Excepción de 16GB + 1TB: hasta $250.
--
-- Una laptop con 16GB de RAM o más y 1TB de SSD o más puede costar hasta $250
-- (el tope general es $200, y la urgente y los reacondicionados llegan a
-- $220). is_high_spec lo escribe HuntService al guardar; los mínimos y el tope
-- viven en search_config (highSpecException) y salen de default-config.ts.
--
-- La vista del dashboard deja ver hasta $250 solo a esas; el resto sigue
-- cortado en $220 (ver 0039).

alter table public.seen_listings
  add column if not exists is_high_spec boolean not null default false;

create or replace view public.deals_public as
select item_id, title, price, currency, condition, cpu_match, score,
       is_great_deal, is_priority, has_description, has_battery_info,
       battery_grade, is_auction, has_best_offer, end_date, seller_username,
       seller_feedback_score, seller_feedback_percentage, url, image_url,
       first_seen_at, bid_count, price_checked_at, special_label, special_demoted,
       is_urgent
  from public.seen_listings
 where qualified = true
   and is_available
   and (price is null or price <= case when is_high_spec then 250 else 220 end);

grant select on public.deals_public to anon, authenticated;

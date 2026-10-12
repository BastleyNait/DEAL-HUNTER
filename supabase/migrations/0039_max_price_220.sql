-- Nada por encima de $220 en el dashboard.
--
-- El tope general sigue siendo $200, pero había dos excepciones que dejaban
-- pasar más: los reacondicionados con "Best Offer" (hasta $225) y la OFERTA
-- URGENTE (que llegó a guardarse hasta $250 antes de bajar su tope a $220). Más
-- las subastas, cuya puja sube después de guardarse. Resultado: 337
-- publicaciones por encima de $220 en la lista.
--
-- - La excepción de reacondicionados pasa a $220, igual que la urgente: nada
--   que se califique ya supera ese precio. (default-config.ts es la fuente;
--   la fila de search_config tenía el valor viejo.)
-- - La vista del dashboard oculta lo que hoy cuesta más de $220 (lo guardado
--   antes del cambio y las subastas cuya puja ya pasó). Si el precio baja y el
--   refresco lo ve, vuelve a aparecer solo.

update public.search_config
   set config = jsonb_set(config, '{refurbishedExceptionMaxPrice}', '220'::jsonb)
 where id = 1;

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
   and (price is null or price <= 220);

grant select on public.deals_public to anon, authenticated;

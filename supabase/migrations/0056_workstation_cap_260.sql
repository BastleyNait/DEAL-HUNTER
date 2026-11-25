-- Estaciones de trabajo confiables (ThinkPad P, HP ZBook, Dell Precision) hasta
-- $260: es el tope del cazador (brandPriceCaps "Estación de trabajo"). Sin
-- esto calificaban y se avisaban, pero el dashboard las escondía por pasar de
-- $220 (una ThinkPad P15s Gen 1 a $230). Mismo patrón que en default-config.ts;
-- en Postgres el borde de palabra es \y, no \b.

create or replace view public.deals_public as
select item_id, title, price, currency, condition, cpu_match, score,
       is_great_deal, is_priority, has_description, has_battery_info,
       battery_grade, is_auction, has_best_offer, end_date, seller_username,
       seller_feedback_score, seller_feedback_percentage, url, image_url,
       first_seen_at, bid_count, price_checked_at, special_label, special_demoted,
       is_urgent, cosmetic_note, gpu, gpu_design, gpu_special
  from public.seen_listings
 where qualified = true
   and is_available
   and (price is null or price <= case when gpu_special then 500
                                       when title ~* '\ythink\s*pad\s*p\d|\yp1[457][sv]?\s*(gen|g)\s*\d|\yp1\s*gen\s*\d|\yzbook\y|\yprecision\y' then 260
                                       when is_high_spec or is_urgent or cpu_match = 'Intel i7 12th gen' then 250
                                       else 220 end);

grant select on public.deals_public to anon, authenticated;

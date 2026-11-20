-- Topes de $250 nuevos: la i7 12.ª (cpuPriceCaps) y la ThinkPad X1 Yoga, que
-- es OFERTA URGENTE hasta $250 (urgentDeal.modelOverrides). Las urgentes
-- normales siguen en $220: el cazador nunca marca urgente una más cara.

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
                                       when is_high_spec or is_urgent or cpu_match = 'Intel i7 12th gen' then 250
                                       else 220 end);

grant select on public.deals_public to anon, authenticated;

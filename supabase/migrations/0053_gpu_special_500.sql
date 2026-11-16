-- ESPECIAL GPU sube a $500 (gpuSpecial.maxPriceUsd). Las que entran solo por
-- este carril no van al bot principal: se ven acá, en el dashboard.

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
                                       when is_high_spec then 250
                                       else 220 end);

grant select on public.deals_public to anon, authenticated;

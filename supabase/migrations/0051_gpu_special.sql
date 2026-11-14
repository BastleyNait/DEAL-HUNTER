-- ESPECIAL GPU: una laptop con gráfica buena para diseño (Quadro P620 o mejor)
-- entra hasta $300 aunque pase los topes generales, que no cambian ($220, y
-- $250 con 16GB + 1TB). gpu_special lo escribe HuntService al guardar; el
-- tope sale de gpuSpecial.maxPriceUsd en default-config.ts.

alter table public.seen_listings
  add column if not exists gpu_special boolean not null default false;

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
   and (price is null or price <= case when gpu_special then 300
                                       when is_high_spec then 250
                                       else 220 end);

grant select on public.deals_public to anon, authenticated;

-- Las que ya están guardadas y calificadas: misma regla que gpu-special.ts,
-- leída del nombre de gráfica guardado. (Las que se descartaron por precio
-- entre $220 y $300 no se reevalúan: entran las nuevas.)
update public.seen_listings
   set gpu_special = true
 where qualified = true
   and price is not null and price <= 300
   and gpu is not null
   and (
     gpu ~* '(quadro (p(6\d\d|[1-5]\d{3})|t\d{3,4}|rtx \d{4})|nvidia t\d{3,4}|rtx a\d{3,4}|geforce gtx (1050\s*ti|106\d|107\d|108\d|16\d\d)|geforce rtx \d{4}|radeon pro (wx (3[1-9]\d{2}|[4-9]\d{3})|[5-9]\d{3}m?)|radeon rx (5[5-9]\d{2}|6\d{3}|7\d{3}))'
     or (gpu like '%según el modelo%'
         and title ~* '(thinkpad\s+p(15v?|17|53|52|1)\M|\mp15v\M|precision\s+(55[3-7]0|75[3-7]0|77[3-7]0|76[3-7]0)\M)')
   );

-- Laptops con gráfica dedicada primero (la P15v dejó el mejor margen).
--
-- gpu: nombre de la gráfica dedicada ("NVIDIA Quadro P620 4GB"), null si es
--      integrada o no se sabe.
-- gpu_design: la gráfica sirve para diseño / AutoCAD (profesional o 4GB+).
--
-- Los defaults nuevos (gpuPriority, gpuSearchProfiles, itemLocationCountry)
-- salen de default-config.ts: son claves nuevas, así que no hace falta tocar
-- search_config.

alter table public.seen_listings
  add column if not exists gpu text,
  add column if not exists gpu_design boolean not null default false;

create or replace view public.deals_public as
select item_id, title, price, currency, condition, cpu_match, score,
       is_great_deal, is_priority, has_description, has_battery_info,
       battery_grade, is_auction, has_best_offer, end_date, seller_username,
       seller_feedback_score, seller_feedback_percentage, url, image_url,
       first_seen_at, bid_count, price_checked_at, special_label, special_demoted,
       is_urgent, cosmetic_note, gpu, gpu_design
  from public.seen_listings
 where qualified = true
   and is_available
   and (price is null or price <= case when is_high_spec then 250 else 220 end);

grant select on public.deals_public to anon, authenticated;

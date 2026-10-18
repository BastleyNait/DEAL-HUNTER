-- Grietas chicas, golpes y detalles estéticos: se marcan, no se descartan.
--
-- Se aceptan si son chicos; hay que verlos en las fotos antes de comprar.
-- - Siguen descartando: pantalla rajada o rota (screen_defect en el título,
--   declared_cracked en la descripción), bisagra rajada o rota, "as-is",
--   daño por agua, y "broken/damaged/defective/faulty" en el título.
-- - Las demás grietas (bezel, carcasa, cerca del trackpad) y "dented" o
--   "cosmetic damage" en el título dejan de descartar. HuntService guarda lo
--   que dijo el vendedor en cosmetic_note, y el dashboard y Telegram lo
--   muestran como "revisar fotos".
-- El patrón sale de default-config.ts (generado, no tipeado a mano).

alter table public.seen_listings
  add column if not exists cosmetic_note text;

update public.search_config
   set config = jsonb_set(config, '{titleExcludePatterns}', (
     select jsonb_agg(
              case when t.e->>'reason' = 'declared_defect'
                   then jsonb_set(t.e, '{pattern}', to_jsonb($p$\bas[-\s]is\b|\bwater\s*damage\b|(?<!\bno\s)(?<!\bnot\s)(?<!\bsin\s)\b(?:broken|damaged|defective|faulty)\b$p$::text))
                   else t.e end
              order by t.o)
       from jsonb_array_elements(config->'titleExcludePatterns') with ordinality as t(e, o)
   ))
 where id = 1;

create or replace view public.deals_public as
select item_id, title, price, currency, condition, cpu_match, score,
       is_great_deal, is_priority, has_description, has_battery_info,
       battery_grade, is_auction, has_best_offer, end_date, seller_username,
       seller_feedback_score, seller_feedback_percentage, url, image_url,
       first_seen_at, bid_count, price_checked_at, special_label, special_demoted,
       is_urgent, cosmetic_note
  from public.seen_listings
 where qualified = true
   and is_available
   and (price is null or price <= case when is_high_spec then 250 else 220 end);

grant select on public.deals_public to anon, authenticated;

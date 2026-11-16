-- Dell resta 10 puntos de frente (antes 5): no se revenden como las ThinkPad.
-- scorePenalties está guardado en search_config, así que se cambia ahí (el
-- default de default-config.ts solo vale si la base no lo tiene).

update public.search_config
   set config = jsonb_set(
         config,
         '{scorePenalties}',
         (select jsonb_agg(case when p->>'label' = 'Dell' then jsonb_set(p, '{points}', '10') else p end order by ord)
            from jsonb_array_elements(config->'scorePenalties') with ordinality as e(p, ord))
       )
 where id = 1;

-- Las Dell ya guardadas: 5 puntos más de resta, y OFERTAZA se recalcula con
-- la misma regla del código (80+, o 16GB+ a $130 o menos con 70+; nunca subasta).
update public.seen_listings
   set score = greatest(0, score - 5),
       is_great_deal = not coalesce(is_auction, false) and (
         greatest(0, score - 5) >= 80
         or (price is not null and price <= 130 and greatest(0, score - 5) >= 70
             and title ~* '\m(1[6-9]|[2-6]\d)\s?gb')
       )
 where score is not null
   and title ~* '\m(dell|latitude|precision|xps|inspiron|vostro|alienware)\M';

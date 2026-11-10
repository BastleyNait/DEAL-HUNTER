-- OFERTAZA = solo puntaje alto (>= greatDealMinScore, 80), nunca por precio.
-- Antes también lo era cualquier equipo de $160 o menos, aunque puntuara bajo.
-- El código ya no mira ese precio (greatDealMaxPrice salió de la config); acá
-- se alinea lo ya guardado para que el dashboard no siga mostrando "Ofertaza"
-- en equipos que con la regla nueva no lo son (y sí en los que subieron por GPU).
-- Una subasta nunca es ofertaza.
update public.seen_listings
   set is_great_deal = (coalesce(score, 0) >= 80 and not is_auction)
 where qualified
   and is_great_deal is distinct from (coalesce(score, 0) >= 80 and not is_auction);

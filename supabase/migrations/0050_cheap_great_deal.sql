-- OFERTAZA, segundo camino: lo muy barato con 16GB o más.
-- Puntaje >= 80 sigue siendo ofertaza; además lo es una de 16GB+ a $130 o menos
-- con puntaje >= 70 (cheapGreatDeal en default-config.ts). Se marca lo ya
-- guardado leyendo la RAM del título; las nuevas la leen del título y la
-- descripción. No hay subastas: el precio final se desconoce.
update public.seen_listings
   set is_great_deal = true
 where qualified
   and not is_auction
   and not is_great_deal
   and price <= 130
   and score >= 70
   and title ~* '(^|[^0-9])(16|24|32|48|64) ?gb';

-- Vendedores cuyas subastas no se avisan por Telegram.
--
-- regencytechnologies publica subastas con pujas bajas que casi siempre
-- terminan por encima de $200. En el primer día con la ventana de 20 minutos
-- fueron 24 de los 27 avisos de subasta, y tapaban los avisos de compra
-- directa. Sus publicaciones siguen apareciendo en el dashboard.
update public.search_config
   set config = config || jsonb_build_object(
         'auctionAlertExcludedSellers', jsonb_build_array('regencytechnologies')
       )
 where id = 1;

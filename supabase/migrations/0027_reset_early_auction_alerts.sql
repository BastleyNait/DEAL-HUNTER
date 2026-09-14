-- Transición a la ventana de 20 minutos para subastas.
--
-- Con la regla vieja, una subasta se marcaba como avisada apenas entraba en
-- sus últimas 24 horas. Al pasar a 20 minutos, esas marcas quedaron puestas
-- y bloqueaban el aviso nuevo: findAuctionsToAlert pide auction_alerted_at
-- nulo, y filter_notifiable descarta lo que ya tiene notified_at.
--
-- A eso se suma que antes de 0025 notified_at se escribía al guardar toda
-- oferta calificada, así que muchas subastas figuraban como avisadas sin
-- haberlo sido nunca.
--
-- Se limpian las dos marcas solo en subastas todavía abiertas y solo si se
-- pusieron antes del despliegue de la ventana de 20 minutos. Lo marcado ya
-- con la regla nueva no se toca, salvo que su notified_at venga de antes:
-- esas quedaron silenciadas por error. Lo que marcaste como visto en el
-- dashboard sigue silenciado, porque eso vive en deal_views.
update public.seen_listings
   set auction_alerted_at = null,
       notified_at = null
 where is_auction
   and end_date > now()
   and (auction_alerted_at < '2026-09-14 00:35:50+00'
        or notified_at < '2026-09-14 00:35:50+00');

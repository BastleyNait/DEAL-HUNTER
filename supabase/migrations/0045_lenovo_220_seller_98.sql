-- Lenovo hasta $220 y vendedores con 98% de feedback positivo o más.
--
-- - brandPriceCaps (Lenovo hasta $220) vive en default-config.ts: la fila de
--   search_config no tiene la clave, así que SupabaseConfigProvider usa la del
--   código. No hace falta tocarla.
-- - minSellerFeedbackPercentage pasa de 95 a 98. Medido en 14 días: de 1.552
--   calificadas, solo 1 quedaría afuera. El mínimo de ventas (1000) no cambia.

update public.search_config
   set config = jsonb_set(config, '{minSellerFeedbackPercentage}', '98'::jsonb)
 where id = 1;

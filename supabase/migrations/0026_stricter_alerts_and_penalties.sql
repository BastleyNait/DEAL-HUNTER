-- Avisos más exigentes y puntaje que castiga lo que frena la reventa.
--
-- 1. Telegram solo avisa ofertas con puntaje mayor a 70, subastas incluidas.
--    Reemplaza a notifyOnlyGreatDeals, que dejaba pasar cualquier CPU
--    prioritaria sin importar el puntaje.
-- 2. Las subastas se avisan cuando faltan 20 minutos o menos, no 24 horas.
--    Con el cron cada 15 minutos, el aviso llega con entre 5 y 20 minutos.
-- 3. Restas fijas al puntaje: -10 si es Dell Latitude, -10 si declara daño
--    (dmg / damage) en título o descripción, sin contar negaciones ni texto de
--    políticas de envío y garantía.
--
-- Las restas solo afectan a lo que se evalúa desde ahora. El recálculo de las
-- ofertas ya guardadas se hace aparte, con el mismo código TypeScript, para no
-- duplicar la lógica de negación en SQL.

update public.search_config
   set config = (config - 'notifyOnlyGreatDeals' - 'auctionAlertMaxHoursLeft')
             || jsonb_build_object(
                  'notifyScoreAbove', 70,
                  'auctionAlertMaxMinutesLeft', 20,
                  'scorePenalties', '[
  {
    "label": "Dell Latitude",
    "pattern": "latitude",
    "flags": "i",
    "points": 10,
    "scope": "title",
    "ignoreNegated": false
  },
  {
    "label": "Declara daño",
    "pattern": "\\b(?:dmg|damaged?)\\b",
    "flags": "i",
    "points": 10,
    "scope": "titleAndDescription",
    "ignoreNegated": true,
    "ignoreContextPattern": "ship|transit|package|parcel|carrier|\\bups\\b|fedex|usps|deliver|return|refund|claim|tamper|arriv|not as (?:described|shown)|warranty|misuse|abuse|accident|avoid|any signs of|materials recovery|sanitized|latches, hinges|used (?:excellent|fair|poor)|new open box"
  }
]'::jsonb
                )
 where id = 1;

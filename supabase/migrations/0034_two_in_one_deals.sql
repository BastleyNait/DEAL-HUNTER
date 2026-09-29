-- El tipo de oferta especial pasa de "Dynabook Portégé" a "2 en 1".
--
-- Laptops convertibles (pantalla que gira 360° o se separa) que cumplen todo
-- lo demás. La Portégé X30W-J/K sigue entrando, pero como 2 en 1 (la W es la
-- variante convertible): la X40 y la X30L, que son clamshell, quedan afuera.
--
-- - Se avisan sin umbral de puntaje: al medir, 58 de las 59 de compra
--   directa disponibles puntúan 70 o menos (8GB, Latitude).
-- - Cuatro búsquedas propias que corren en todas las corridas (x360, 2n1,
--   yoga, 2-in-1), elegidas por cobertura contra la API real.
--
-- Los valores salen de default-config.ts (generado, no tipeado a mano): así
-- los patrones regex quedan idénticos en código y en la base.

update public.search_config
   set config = config || jsonb_build_object(
         'specialDeals', '[
  {
    "label": "2 en 1",
    "pattern": "^(?=.*(?:dynabook|port[eé]g[eé]|toshiba)).*\\bx30w[\\s-]?j\\b",
    "flags": "i",
    "impliedIntelGeneration": 11
  },
  {
    "label": "2 en 1",
    "pattern": "^(?=.*(?:dynabook|port[eé]g[eé]|toshiba)).*\\bx30w[\\s-]?k\\b",
    "flags": "i",
    "impliedIntelGeneration": 12
  },
  {
    "label": "2 en 1",
    "pattern": "\\b(?:2[\\s-]?in[\\s-]?1|2n1|two[\\s-]?in[\\s-]?one|convertible|x360|flip|spin\\s?\\d{1,2}|flex\\s?\\d{1,2})\\b|\\byoga(?!\\s?(?:slim|pro))|360\\s?(?:°|º|deg)",
    "flags": "i",
    "impliedIntelGeneration": null
  }
]'::jsonb,
         'specialSearchProfiles', '[
  {
    "query": "x360",
    "sort": "newlyListed",
    "maxPages": 1
  },
  {
    "query": "2n1",
    "sort": "newlyListed",
    "maxPages": 1
  },
  {
    "query": "yoga",
    "sort": "newlyListed",
    "maxPages": 1
  },
  {
    "query": "2-in-1",
    "sort": "newlyListed",
    "maxPages": 1
  }
]'::jsonb
       )
 where id = 1;

-- Las marcas viejas ya no significan nada. Las nuevas de lo ya guardado se
-- calculan aparte con el mismo detector del código; lo nuevo lo marca
-- HuntService al guardar.
update public.seen_listings
   set special_label = null
 where special_label is not null;

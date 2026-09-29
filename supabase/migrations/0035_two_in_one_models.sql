-- 2 en 1: modelos que lo son aunque el vendedor no lo diga, y una búsqueda
-- combinada para encontrarlos.
--
-- Buscados en la web y medidos contra las ~9.000 publicaciones guardadas:
-- HP Elite Dragonfly (23 se escapaban), Latitude/ThinkPad Detachable,
-- Surface Book y Laptop Studio, códigos de Asus Flip, IdeaPad C340, Fujitsu
-- Lifebook U9xx, Dell XPS 13 9365, Dynabook X20W. Se excluyen Chromebook y
-- las tablets "tablet only" / "no keyboard".
--
-- NO se marcan Latitude 5310/5320/7320/7410/7420/9420 y similares: existen en
-- las dos versiones y, de 1.127 títulos medidos, solo 1 decía 2 en 1 en la
-- descripción. Sin la palabra no se pueden distinguir de la versión normal.
--
-- La quinta búsqueda junta ~10 modelos con la sintaxis OR de eBay (varios
-- términos entre paréntesis): una sola llamada, +96 por día.
--
-- Los valores son los de default-config.ts. Los patrones llevan la barra
-- invertida doble porque van dentro de un JSON.

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
    "pattern": "\\b(?:2[\\s-]?in[\\s-]?1|2n1|two[\\s-]?in[\\s-]?one|convertible|x360|flip|spin\\s?\\d{1,2}|flex\\s?\\d{1,2}|detachable|dragonfly|surface\\s?book|laptop\\s?studio|c340|xps\\s?13\\s?9365|x20w)\\b|\\byoga(?!\\s?(?:slim|pro))|360\\s?(?:°|º|deg)|\\bux(?:360|370|461|462|463|561|562|563)\\w*|\\bt[pm]4\\d{2}\\w*|\\blifebook\\s?u9\\w*",
    "flags": "i",
    "impliedIntelGeneration": null,
    "excludePattern": "chrome\\s?(?:os|book)|tablet\\s?only|no\\s?keyboard"
  }
]'::jsonb,
         'specialSearchProfiles', '[
  { "query": "x360", "sort": "newlyListed", "maxPages": 1 },
  { "query": "2n1", "sort": "newlyListed", "maxPages": 1 },
  { "query": "yoga", "sort": "newlyListed", "maxPages": 1 },
  { "query": "2-in-1", "sort": "newlyListed", "maxPages": 1 },
  {
    "query": "(dragonfly, detachable, \"laptop studio\", \"zenbook flip\", \"vivobook flip\", c340, \"lifebook u9\", \"xps 9365\", x20w, \"surface book 3\")",
    "sort": "newlyListed",
    "maxPages": 1
  }
]'::jsonb
       )
 where id = 1;

-- Las marcas se recalculan con el mismo detector del código (script aparte).
update public.seen_listings
   set special_label = null
 where special_label is not null;

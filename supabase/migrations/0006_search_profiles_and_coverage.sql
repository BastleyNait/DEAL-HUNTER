-- Cobertura: de una sola query ("laptop") a un pool rotativo de vetas de
-- búsqueda, condition IDs completos, y dos CPUs estrictamente superiores.
--
-- Medido contra la Browse API real antes de definir esto:
--   q=laptop      -> 92.268 resultados, pero solo ~23 de cada 100 son CPU objetivo
--   q=1145g7      ->    949 resultados, 99 de cada 100 son CPU objetivo
--   q=1135g7      ->    894 resultados, 99/100
--   q=i5 11th gen ->    249 resultados, 100/100
-- Por eso el grueso del pool son queries por número de modelo ordenadas por
-- precio (las más baratas de cada veta = las mejores ofertas).

update public.search_config
set config = config || jsonb_build_object(
  -- 2010/2020/2030 (Excellent/Very Good/Good - Refurbished), 2750 (Like New) y
  -- 1750 (New with defects) faltaban: eBay estaba filtrando esos listados del
  -- lado del servidor, justo el segmento de refurbished que interesa.
  'includedConditionIds', jsonb_build_array(1000, 1500, 1750, 2000, 2010, 2020, 2030, 2500, 2750, 3000, 4000, 5000, 6000),
  'refurbishedConditionIds', jsonb_build_array(2000, 2010, 2020, 2030, 2500),
  'profilesPerRun', 10,
  'maxCandidatesPerRun', 30,
  -- Con el pool ampliado salen decenas de ofertas por corrida: Telegram recibe
  -- una por una solo las ofertazas (tope maxNotificationsPerRun) y el resto va
  -- en un mensaje de resumen. En el dashboard aparecen todas igual.
  'notifyOnlyGreatDeals', true,
  'maxNotificationsPerRun', 8,
  'searchProfiles', '[
    { "query": "laptop",              "sort": "newlyListed",   "maxPages": 2 },
    { "query": "notebook i7",         "sort": "newlyListed",   "maxPages": 1 },
    { "query": "i7 11th gen",         "sort": "newlyListed",   "maxPages": 1 },
    { "query": "i5 11th gen",         "sort": "newlyListed",   "maxPages": 1 },
    { "query": "i5 12th gen",         "sort": "newlyListed",   "maxPages": 1 },
    { "query": "i7 10th gen",         "sort": "newlyListed",   "maxPages": 1 },
    { "query": "i7 12th gen",         "sort": "newlyListed",   "maxPages": 1 },
    { "query": "ryzen 5 laptop",      "sort": "newlyListed",   "maxPages": 1 },
    { "query": "ryzen 7 laptop",      "sort": "newlyListed",   "maxPages": 1 },
    { "query": "1135g7",              "sort": "price",         "maxPages": 1 },
    { "query": "1145g7",              "sort": "price",         "maxPages": 1 },
    { "query": "1155g7",              "sort": "price",         "maxPages": 1 },
    { "query": "1165g7",              "sort": "price",         "maxPages": 1 },
    { "query": "1185g7",              "sort": "price",         "maxPages": 1 },
    { "query": "11300h",              "sort": "price",         "maxPages": 1 },
    { "query": "11400h",              "sort": "price",         "maxPages": 1 },
    { "query": "11800h",              "sort": "price",         "maxPages": 1 },
    { "query": "11370h",              "sort": "price",         "maxPages": 1 },
    { "query": "1235u",               "sort": "price",         "maxPages": 1 },
    { "query": "1240p",               "sort": "price",         "maxPages": 1 },
    { "query": "1245u",               "sort": "price",         "maxPages": 1 },
    { "query": "12500h",              "sort": "price",         "maxPages": 1 },
    { "query": "1265u",               "sort": "price",         "maxPages": 1 },
    { "query": "12700h",              "sort": "price",         "maxPages": 1 },
    { "query": "10510u",              "sort": "price",         "maxPages": 1 },
    { "query": "10610u",              "sort": "price",         "maxPages": 1 },
    { "query": "10710u",              "sort": "price",         "maxPages": 1 },
    { "query": "1065g7",              "sort": "price",         "maxPages": 1 },
    { "query": "10750h",              "sort": "price",         "maxPages": 1 },
    { "query": "10850h",              "sort": "price",         "maxPages": 1 },
    { "query": "ryzen 5 5500u",       "sort": "price",         "maxPages": 1 },
    { "query": "ryzen 5 5625u",       "sort": "price",         "maxPages": 1 },
    { "query": "ryzen 5 5600h",       "sort": "price",         "maxPages": 1 },
    { "query": "ryzen 7 5700u",       "sort": "price",         "maxPages": 1 },
    { "query": "ryzen 7 5800h",       "sort": "price",         "maxPages": 1 },
    { "query": "ryzen 7 4700u",       "sort": "price",         "maxPages": 1 },
    { "query": "ryzen 7 4800h",       "sort": "price",         "maxPages": 1 },
    { "query": "latitude i5",         "sort": "price",         "maxPages": 1 },
    { "query": "elitebook i5",        "sort": "price",         "maxPages": 1 },
    { "query": "thinkpad i7",         "sort": "price",         "maxPages": 1 },
    { "query": "probook ryzen",       "sort": "price",         "maxPages": 1 },
    { "query": "laptop i7",           "sort": "endingSoonest", "maxPages": 1 },
    { "query": "laptop i5",           "sort": "endingSoonest", "maxPages": 1 }
  ]'::jsonb
)
where id = 1;

-- CPUs: se agregan i7 12va gen y Ryzen 7 5000 (estrictamente mejores que las
-- que ya estaban, al mismo tope de precio). El orden del array importa: gana el
-- primer patrón que matchea, por eso van de mejor a peor tier.
update public.search_config
set config = jsonb_set(
  config,
  '{cpuPatterns}',
  '[
    { "label": "Intel i7 12th gen", "pattern": "\\bi7[\\s®™_-]*12\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b12[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 8 },
    { "label": "Intel i7 11th gen", "pattern": "\\bi7[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 7 },
    { "label": "AMD Ryzen 7 5000", "pattern": "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?5\\d{3}[a-z]{0,2}\\b", "flags": "i", "tier": 6 },
    { "label": "Intel i5 12th gen", "pattern": "\\bi5[\\s®™_-]*12\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b12[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 5 },
    { "label": "Intel i7 10th gen", "pattern": "\\bi7[\\s®™_-]*10\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b10[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 4 },
    { "label": "AMD Ryzen 7 4000", "pattern": "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?4\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b4000\\b)", "flags": "i", "tier": 3 },
    { "label": "Intel i5 11th gen", "pattern": "\\bi5[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 2 },
    { "label": "AMD Ryzen 5 5000", "pattern": "\\b(?:ryzen[\\s®™_-]*5|r5)[\\s-]?5\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b5000\\b)", "flags": "i", "tier": 1 }
  ]'::jsonb
)
where id = 1;

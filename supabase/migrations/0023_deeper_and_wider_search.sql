-- Más cobertura, decidida midiendo contra la API en vez de adivinando.
--
-- 1) PROFUNDIDAD. Las vetas por número de modelo tenían maxPages=1, o sea que
--    solo se miraban las 100 más baratas. Medido: las páginas 2 y 3 son igual
--    de densas (1135g7: 100/100, 99/100, 100/100 de coincidencias; 1145g7:
--    96, 98, 98). Se estaba dejando de mirar 2 o 3 veces ese inventario.
--
-- 2) VETAS NUEVAS. De 33 candidatas probadas, se agregan las que rinden:
--      1255u   30 resultados, 100% de precisión
--      11850h  13, 100%       5825u   12, 100%
--      1260p    8, 100%       1270p    8, 100%
--      10875h   6, 100%       1130g7   4, 100%     1250p  3, 100%
--      zbook firefly  184, 38%     latitude 7430  30, 60%
--      thinkpad e14   213, 19%     thinkpad t15    42, 21%
--      thinkpad x1 yoga 171, 7% (baja precisión pero es el tier de reventa más alto)
--    Se descartan las que dieron cero: 12450h, 11260h, 1045g7, 7540u, 7640u,
--    7840u, 5875u, elitebook 845, probook 450. Y 1215u / 1115g4 / 1035g1, que
--    traen volumen pero son i3 o i5 10ma: el matcher las rechaza bien.
--
-- 3) Se quita el duplicado de "1245u" y sube profilesPerRun a 12 para que el
--    pool más grande siga recorriéndose en ~90 minutos.

update public.search_config
set config = jsonb_set(
  config,
  '{searchProfiles}',
  (
    -- Desduplica por query y sube la profundidad de las vetas densas.
    select coalesce(jsonb_agg(distinct
      case when p->>'query' in (
        '1135g7','1145g7','1155g7','1165g7','1185g7','1235u','1240p','1245u',
        '10510u','10610u','10710u','1065g7','11800h','12500h'
      )
      then jsonb_build_object('query', p->>'query', 'sort', p->>'sort', 'maxPages', 3)
      else p end
    ), '[]'::jsonb)
    from jsonb_array_elements(config->'searchProfiles') as p
  )
)
where id = 1;

update public.search_config
set config = jsonb_set(
  config,
  '{searchProfiles}',
  (config->'searchProfiles') || '[
    { "query": "1255u",            "sort": "price", "maxPages": 2 },
    { "query": "11850h",           "sort": "price", "maxPages": 1 },
    { "query": "5825u",            "sort": "price", "maxPages": 1 },
    { "query": "1260p",            "sort": "price", "maxPages": 1 },
    { "query": "1270p",            "sort": "price", "maxPages": 1 },
    { "query": "10875h",           "sort": "price", "maxPages": 1 },
    { "query": "1130g7",           "sort": "price", "maxPages": 1 },
    { "query": "1250p",            "sort": "price", "maxPages": 1 },
    { "query": "zbook firefly",    "sort": "price", "maxPages": 2 },
    { "query": "latitude 7430",    "sort": "price", "maxPages": 1 },
    { "query": "thinkpad e14",     "sort": "price", "maxPages": 2 },
    { "query": "thinkpad t15",     "sort": "price", "maxPages": 1 },
    { "query": "thinkpad x1 yoga", "sort": "price", "maxPages": 2 }
  ]'::jsonb
)
where id = 1;

update public.search_config
set config = config || jsonb_build_object('profilesPerRun', 12)
where id = 1;

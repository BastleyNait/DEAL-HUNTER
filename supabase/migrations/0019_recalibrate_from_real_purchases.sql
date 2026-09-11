-- Recalibración del sistema de recomendación contra las 6 compras reales.
--
-- Lo que mostraban esas compras (precios de $154 a $200, 16GB en 5 de 6,
-- 256GB en 5 de 6, 4 ThinkPad y 2 Dynabook Portégé):
--
--   * El precio pesaba 40% con "más barato = mejor", así que la chatarra de
--     $50-90 encabezaba la lista y enterraba justo lo que sí se compra. Baja a
--     14% y se aplana por debajo de la mitad del tope: lo que se busca es la
--     mejor máquina que entre en el presupuesto, no la más barata.
--   * La RAM pesaba 5% siendo un requisito de hecho. Sube a 24%.
--   * 256GB de disco penalizaba como si fuera poco. Ahora casi no penaliza.
--   * Faltaba la serie Ryzen 7000: una compra real fue un Ryzen 5 7530U que el
--     sistema no reconocía.
--   * La i5 12va tenía tier 5 siendo la CPU de 3 de las 6 compras. Sube a 7.
--   * Se agrega un factor de modelo (líneas corporativas delgadas).
--
-- Medido antes/después con las compras reales como referencia: el top-4 pasó de
-- ser 4 publicaciones descartables a ser 4 de las compras reales.

update public.search_config
set config = config || jsonb_build_object(
  'preferredModels', jsonb_build_array(
    'thinkpad', 'portege', 'port[ée]g[ée]', 'dynabook', 'latitude',
    'elitebook', 'probook', 'zbook', 'precision', 'surface\s+laptop'
  ),
  'cpuPatterns', '[
    { "label": "Intel i7 12th gen", "pattern": "\\bi7[\\s®™_-]*12\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b12[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 8 },
    { "label": "Intel i7 11th gen", "pattern": "\\bi7[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 7 },
    { "label": "Intel i5 12th gen", "pattern": "\\bi5[\\s®™_-]*12\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b12[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 7 },
    { "label": "AMD Ryzen 7 7000", "pattern": "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?7\\d{3}[a-z]{0,2}\\b", "flags": "i", "tier": 7 },
    { "label": "AMD Ryzen 5 7000", "pattern": "\\b(?:ryzen[\\s®™_-]*5|r5)[\\s-]?7\\d{3}[a-z]{0,2}\\b", "flags": "i", "tier": 6 },
    { "label": "AMD Ryzen 7 5000", "pattern": "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?5\\d{3}[a-z]{0,2}\\b", "flags": "i", "tier": 5 },
    { "label": "Intel i7 10th gen", "pattern": "\\bi7[\\s®™_-]*10\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b10[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 4 },
    { "label": "Intel i5 11th gen", "pattern": "\\bi5[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 4 },
    { "label": "AMD Ryzen 7 4000", "pattern": "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?4\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b4000\\b)", "flags": "i", "tier": 3 },
    { "label": "AMD Ryzen 5 5000", "pattern": "\\b(?:ryzen[\\s®™_-]*5|r5)[\\s-]?5\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b5000\\b)", "flags": "i", "tier": 2 }
  ]'::jsonb
)
where id = 1;

-- Vetas nuevas: lo que realmente se compra.
update public.search_config
set config = jsonb_set(
  config,
  '{searchProfiles}',
  (config->'searchProfiles') || '[
    { "query": "thinkpad l14",      "sort": "price",        "maxPages": 1 },
    { "query": "thinkpad l15",      "sort": "price",        "maxPages": 1 },
    { "query": "thinkpad l13",      "sort": "price",        "maxPages": 1 },
    { "query": "thinkpad t14",      "sort": "price",        "maxPages": 1 },
    { "query": "dynabook portege",  "sort": "price",        "maxPages": 1 },
    { "query": "portege x30",       "sort": "price",        "maxPages": 1 },
    { "query": "7530u",             "sort": "price",        "maxPages": 1 },
    { "query": "7730u",             "sort": "price",        "maxPages": 1 },
    { "query": "1245u",             "sort": "newlyListed",  "maxPages": 1 }
  ]'::jsonb
)
where id = 1;

-- Las CPUs que antes no se reconocían pueden estar guardadas como descartadas
-- por no matchear ninguna: se liberan para que el cazador las vuelva a evaluar.
delete from public.seen_listings
where qualified = false and reject_reason is null;

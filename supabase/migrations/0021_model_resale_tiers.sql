-- El modelo pasa de un bonus binario (5%) a un escalafón de reventa (18%),
-- casi tanto como la RAM: dos máquinas con la misma ficha no valen lo mismo si
-- una es ThinkPad y la otra una línea de consumo.
--
-- Criterio: las compras reales (4 ThinkPad, 2 Dynabook Portégé) más lo que se
-- sostiene del mercado de segunda mano — las ThinkPad T/X tienen chasis de
-- magnesio o fibra de vidrio y son de las más duraderas, con repuestos fáciles;
-- las EliteBook son de las corporativas que mejor envejecen; las Latitude son
-- confiables pero sin ventaja de durabilidad, y llegan con la tapa muy rayada,
-- que es justo lo que frena la reventa.
--
-- Con ficha idéntica (i5-1235U 16GB 256GB $175): ThinkPad 84, EliteBook 82,
-- Portégé 81, ProBook 79, Latitude 75, Inspiron 71. El techo de una ThinkPad
-- excelente (i7 12va, 32GB, 1TB, Very Good, $120) es 94, así que queda margen.
--
-- También se re-balancea el resto: "Used" era 0.6 cuando es el estado normal
-- del negocio, y no saber el % de batería costaba medio factor cuando la
-- mayoría de las publicaciones no lo dice. Ninguna compra buena podía acercarse
-- al tope de la escala.

update public.search_config
set config = (config - 'preferredModels') || jsonb_build_object(
  'modelFallbackWeight', 0.25,
  'modelTiers', '[
    { "label": "ThinkPad T / X / P",             "pattern": "thinkpad\\s*[txp]\\d|thinkpad\\s*x1", "flags": "i", "weight": 1 },
    { "label": "ThinkPad (cualquier linea)",     "pattern": "thinkpad|think\\s*pad",               "flags": "i", "weight": 0.95 },
    { "label": "HP EliteBook / ZBook",           "pattern": "elitebook|zbook",                     "flags": "i", "weight": 0.85 },
    { "label": "Dynabook Portege / Tecra",       "pattern": "port[ée]g[ée]|portege|dynabook|tecra","flags": "i", "weight": 0.8 },
    { "label": "HP ProBook",                     "pattern": "probook",                             "flags": "i", "weight": 0.68 },
    { "label": "Dell Precision / Surface Laptop","pattern": "precision|surface\\s*laptop",         "flags": "i", "weight": 0.55 },
    { "label": "Dell Latitude",                  "pattern": "latitude",                            "flags": "i", "weight": 0.5 }
  ]'::jsonb
)
where id = 1;

-- Más vetas de ThinkPad, que es lo que ahora se prioriza.
update public.search_config
set config = jsonb_set(
  config,
  '{searchProfiles}',
  (config->'searchProfiles') || '[
    { "query": "thinkpad x1 carbon", "sort": "price",       "maxPages": 1 },
    { "query": "thinkpad t14s",      "sort": "price",       "maxPages": 1 },
    { "query": "thinkpad x13",       "sort": "price",       "maxPages": 1 },
    { "query": "thinkpad t490",      "sort": "price",       "maxPages": 1 },
    { "query": "thinkpad",           "sort": "newlyListed", "maxPages": 2 }
  ]'::jsonb
)
where id = 1;

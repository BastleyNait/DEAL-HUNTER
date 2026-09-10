-- Dos huecos que dejaba el filtro de defectos, encontrados sobre datos reales:
-- una publicación titulada "... No OS D-Grade" cuya descripción decía
-- "Laptops are considered D-Grade. They have damage such as cracks, dents and
-- display blemishes". El título no traía ninguna de las frases filtradas y el
-- daño estaba declarado en la descripción.
--
--   1) Grado del equipo entero D o F en el título -> descarta.
--      El grado C queda afuera a propósito: esas se marcan para revisar.
--   2) Daño declarado en la descripción con frases concretas ("damage such as",
--      "have damage", "display blemishes"). Son afirmaciones del vendedor, no
--      las muletillas tipo "may show signs of wear" que trae cualquier
--      refurbisher, así que acá sí vale mirar la descripción.

update public.search_config
set config = jsonb_set(
  config,
  '{titleExcludePatterns}',
  (config->'titleExcludePatterns') || '[
    { "reason": "low_grade_unit", "pattern": "\\b[df][\\s-]?grade\\b|\\bgrade\\s*[-:]?\\s*[df]\\b", "flags": "i" }
  ]'::jsonb
)
where id = 1;

update public.search_config
set config = jsonb_set(
  config,
  '{excludePatterns}',
  (config->'excludePatterns') || '[
    { "reason": "declared_damage", "pattern": "\\bdamage\\s+such\\s+as\\b|\\b(?:have|has|with)\\s+damage\\b|\\bdisplay\\s+blemish", "flags": "i" }
  ]'::jsonb
)
where id = 1;

-- Limpieza de lo ya guardado.
update public.seen_listings
set qualified = false, reject_reason = 'low_grade_unit'
where qualified = true
  and title ~* '\m[df][\s-]?grade\M|\mgrade\s*[-:]?\s*[df]\M';

update public.seen_listings
set qualified = false, reject_reason = 'declared_damage'
where qualified = true
  and coalesce(seller_description, '') ~* '\mdamage\s+such\s+as\M|\m(have|has|with)\s+damage\M|\mdisplay\s+blemish';

-- El patrón "declared_damage" en config descartaba máquinas sanas: las
-- descripciones de eBay están llenas de negaciones ("✅ No Water Damage",
-- "won't be any significant damage", "does not cover cosmetic damage"). De 8
-- descartes revisados a mano, 4 estaban mal.
--
-- Ahora es regla de código (rules/exclusion-rules.ts -> declaredDamageRule),
-- porque necesita cruzar dos señales: que aparezca la frase Y que no venga
-- negada en la misma oración. Además "cosmetic damage" a secas dejó de
-- descartar: rayones y marcas son la línea base de una corporativa usada.

update public.search_config
set config = jsonb_set(
  config,
  '{excludePatterns}',
  (
    select coalesce(jsonb_agg(p), '[]'::jsonb)
    from jsonb_array_elements(config->'excludePatterns') as p
    where p->>'reason' <> 'declared_damage'
  )
)
where id = 1;

-- Devuelve a la lista todo lo descartado por la regla vieja. Un script de
-- mantenimiento vuelve a evaluarlas con la lógica nueva y descarta las que sí
-- tienen daño real.
update public.seen_listings
set qualified = true, reject_reason = null
where reject_reason = 'declared_damage';

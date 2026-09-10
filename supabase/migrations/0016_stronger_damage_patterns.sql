-- Refuerzo del filtro de daño declarado. La versión anterior no agarraba esta
-- publicación real, que pasó como "ofertaza" de $120:
--
--   "Please review the following severe chassis damage, split hinge mechanics,
--    port frame breakage, wiped storage drives, and display spots before
--    purchasing: Severe Structural Frame Damage... the display lid is unable to
--    close completely"
--
-- La palabra "damage" sola sigue sin alcanzar a propósito: aparece en cláusulas
-- de envío ("not responsible for damage during shipping") y en frases positivas
-- ("no damage", "shows no signs of damage"). Siempre tiene que venir con qué
-- está dañado, o con quién lo afirma.

update public.search_config
set config = jsonb_set(
  config,
  '{excludePatterns}',
  (
    select coalesce(jsonb_agg(
      case when p->>'reason' = 'declared_damage'
        then jsonb_build_object(
          'reason', 'declared_damage',
          'pattern', '\bdamage\s+such\s+as\b|\b(?:have|has|with|showing)\s+damage\b|\b(?:severe|significant|major|structural|chassis|frame|physical|cosmetic|water|screen|display|lcd)\s+(?:\w+\s+){0,2}damage\b|\bbreakage\b|\bsplit\s+hinge\b|\bdisplay\s+(?:blemish|spot)|\bunable\s+to\s+close\b',
          'flags', 'i'
        )
        else p
      end
    ), '[]'::jsonb)
    from jsonb_array_elements(config->'excludePatterns') as p
  )
)
where id = 1;

-- Limpieza de lo ya guardado. Postgres no tiene (?:...) con \b, usa \m y \M.
update public.seen_listings
set qualified = false, reject_reason = 'declared_damage'
where qualified = true
  and coalesce(seller_description, '') ~* (
    '\mdamage\s+such\s+as\M'
    || '|\m(have|has|with|showing)\s+damage\M'
    || '|\m(severe|significant|major|structural|chassis|frame|physical|cosmetic|water|screen|display|lcd)\s+(\w+\s+){0,2}damage\M'
    || '|\mbreakage\M'
    || '|\msplit\s+hinge\M'
    || '|\mdisplay\s+(blemish|spot)'
    || '|\munable\s+to\s+close\M'
  );

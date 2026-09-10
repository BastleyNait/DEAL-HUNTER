-- Defectos declarados en el título. El objetivo del negocio es revender rápido,
-- así que un equipo con la pantalla o el teclado tocado no sirve aunque el
-- precio sea bueno.
--
-- Van contra el TÍTULO y no contra la descripción a propósito: casi todo
-- refurbisher mete muletillas tipo "may show signs of wear" o "may have minor
-- scratches" en la descripción, y filtrar ahí descartaría equipos sanos. El
-- vendedor que tiene un defecto real que declarar lo pone en el título.
--
-- Los patrones de repuestos y BIOS bloqueado, que antes estaban hardcodeados en
-- el código, se mudan acá para que todo el criterio sea editable sin redeploy.

update public.search_config
set config = config || jsonb_build_object(
  'titleExcludePatterns', '[
    { "reason": "part_or_component", "pattern": "\\b(?:motherboard|mainboard|system\\s*board|logic\\s*board|palm\\s*rest|palmrest|heat\\s*sink|heatsink|fan|cooler|hinge|bezel|ribbon|(?:lcd|screen|display|keyboard|touchpad|battery|webcam|speaker)\\s*(?:assembly|replacement|only))\\b", "flags": "i" },
    { "reason": "bios_locked", "pattern": "\\bbios\\s*(?:is\\s*)?(?:locked|password)\\b|\\blocked\\s*to\\s*bios\\b", "flags": "i" },
    { "reason": "screen_defect", "pattern": "\\b(?:hot\\s*spot|hotspot|pressure\\s*(?:mark|spot)|dead\\s*pixel|stuck\\s*pixel|backlight\\s*bleed|screen\\s*(?:damage|crack|scratch|issue|burn)|cracked\\s*screen|broken\\s*screen|discolor)", "flags": "i" },
    { "reason": "keyboard_defect", "pattern": "\\b(?:keyboard|key|trackpad|touchpad)\\s*(?:issue|problem|damage|not\\s*working)\\b|\\bmissing\\s*keys?\\b|\\bkeys?\\s*missing\\b|\\bsticky\\s*keys\\b", "flags": "i" },
    { "reason": "declared_defect", "pattern": "\\bcosmetic\\s*(?:issue|damage|defect|flaw)|\\bas[-\\s]is\\b|\\bwater\\s*damage\\b|(?<!\\bno\\s)(?<!\\bnot\\s)(?<!\\bsin\\s)\\b(?:cracked|broken|damaged|dented|defective|faulty)\\b", "flags": "i" }
  ]'::jsonb
)
where id = 1;

-- Limpieza de lo ya guardado bajo las reglas viejas. Postgres usa \m y \M para
-- los límites de palabra, y no tiene lookbehind, así que la condición de "no
-- cracks / no dents" se expresa como un NOT aparte.
update public.seen_listings
set qualified = false, reject_reason = 'title_defect'
where qualified = true
  and (
    title ~* '\m(hot\s*spot|hotspot|pressure\s*(mark|spot)|dead\s*pixel|stuck\s*pixel|backlight\s*bleed|cracked\s*screen|broken\s*screen|discolor)'
    or title ~* 'screen\s*(damage|crack|scratch|issue|burn)'
    or title ~* '\m(keyboard|key|trackpad|touchpad)\s*(issue|problem|damage|not\s*working)\M'
    or title ~* '\mmissing\s*keys?\M'
    or title ~* '\mkeys?\s*missing\M'
    or title ~* '\msticky\s*keys\M'
    or title ~* '\mcosmetic\s*(issue|damage|defect|flaw)'
    or title ~* '\mas[-\s]is\M'
    or title ~* '\mwater\s*damage\M'
    or (
      title ~* '\m(cracked|broken|damaged|dented|defective|faulty)\M'
      and title !~* '\m(no|not|sin)\s+(cracked|broken|damaged|dented|defective|faulty)\M'
    )
  );

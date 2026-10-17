-- "For parts / not working" descartaba laptops sanas.
--
-- Caso real: una ThinkPad L13 Yoga Gen 2 i5-1145G7 16GB a $189.98 se descartó
-- como "para repuestos" porque la descripción decía "One USB C Port not
-- working". De las 1.837 descartadas por ese motivo, 1.089 lo eran solo por la
-- descripción, y casi todas por error:
--   - "no power": 402, casi siempre "No power adapter included" (sin cargador);
--   - "not working": 232, de la política de devoluciones ("If the item is not
--     working as described...") o de un componente suelto;
--   - "for parts": 110, de la política ("except items listed as AS-IS or for
--     Parts/Repair").
-- Medido con la lógica nueva: 1.273 de las 1.837 calificarían.
--
-- - En la descripción pasa a ser regla de código (declaresUnitFailure): solo
--   descarta lo que habla de la laptop entera, fuera de frases de política.
-- - En el título sigue siendo patrón (titleExcludePatterns), salvo "No Power
--   Adapter/Cord".
-- - Un componente que no funciona resta 10 puntos ("Componente con falla").
-- - Reglas nuevas de código, también para no dejar pasar basura: sin RAM
--   (missing_ram) y rajado/roto dicho en la descripción (declared_cracked).
--   "No OS" sigue siendo válido.
-- Los patrones salen de default-config.ts (generados, no tipeados a mano).

update public.search_config
   set config = jsonb_set(config, '{excludePatterns}', (
     select coalesce(jsonb_agg(p), '[]'::jsonb)
       from jsonb_array_elements(config->'excludePatterns') as p
      where p->>'reason' <> 'for_parts_or_not_working'
   ))
 where id = 1;

update public.search_config
   set config = jsonb_set(config, '{titleExcludePatterns}',
     jsonb_build_array($j${"reason":"for_parts_or_not_working","pattern":"for\\s*parts|not\\s*working|parts\\s*only|parts[\\s\\/]*repair|no\\s*enciende|no\\s*prende|no\\s*power(?!\\s*(?:(?:adapter|cord|supply|supplies|cable|charger|brick|pack|plug)s?\\b|ac\\b|included))","flags":"i"}$j$::jsonb) || (
       select coalesce(jsonb_agg(p), '[]'::jsonb)
         from jsonb_array_elements(config->'titleExcludePatterns') as p
        where p->>'reason' <> 'for_parts_or_not_working'
     ))
 where id = 1;

update public.search_config
   set config = jsonb_set(config, '{scorePenalties}', (
     select coalesce(jsonb_agg(p), '[]'::jsonb)
       from jsonb_array_elements(config->'scorePenalties') as p
      where p->>'label' <> 'Componente con falla'
   ) || jsonb_build_array($j${"label":"Componente con falla","pattern":"\\b(?:ports?|usb(?:[\\s-]?[ac])?|webcam|camera|cam|speakers?|audio|sound|mic(?:rophone)?|bluetooth|wi-?fi|wireless|fingerprint|reader|touch\\s*screen|touchscreen|touch|trackpad|touchpad|mouse|clicks?|keys?|keyboard|backlight|stylus|pen|buttons?|jack|hdmi|ethernet|lan|sd|card|fan|led|lights?|sensor|nfc|sim|lte|wwan|display\\s*port|screws?|covers?|feet|foot|rubber|latch)\\b(?:[^.!?\\n|•]|\\.(?=\\d)){0,40}?\\b(?:not\\s*working|(?:does\\s*not|doesn'?t|won'?t)\\s*work|non[\\s-]?functional|inoperable)\\b","flags":"i","points":10,"scope":"titleAndDescription","ignoreNegated":true,"ignoreContextPattern":"return|refund|warrant|guarant|polic|listed\\s+as|label|exclud|exception|unless|\\bif\\b|\\bmay\\b|\\bshould\\b|buyer|grade[sd]?\\b|definition|not\\s+tested|untested|focus\\s+materials|\\bwe\\s+(?:will|do|are|can)|contact|as\\s+described"}$j$::jsonb))
 where id = 1;

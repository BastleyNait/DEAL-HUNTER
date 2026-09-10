-- 1) Normaliza el reconocimiento de CPUs: cubre modelos de 4 y 5 dígitos
--    (ej. i7-1165G7 vs i7-11800H, misma generación pero distinto largo),
--    símbolos ®/™, abreviaturas R5/R7, y menciones de "11th Gen"/"12th Gen"
--    sin modelo específico. Esto pisa el valor sembrado en 0003 con el
--    mismo criterio que quedó en domain/default-config.ts.
update public.search_config
set config = jsonb_set(
  config,
  '{cpuPatterns}',
  '[
    { "label": "Intel i7 11th gen", "pattern": "\\bi7[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 6 },
    { "label": "Intel i5 12th gen", "pattern": "\\bi5[\\s®™_-]*12\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b12[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 5 },
    { "label": "Intel i7 10th gen", "pattern": "\\bi7[\\s®™_-]*10\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b10[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 4 },
    { "label": "AMD Ryzen 7 4000", "pattern": "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?4\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b4000\\b)", "flags": "i", "tier": 3 },
    { "label": "Intel i5 11th gen", "pattern": "\\bi5[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)", "flags": "i", "tier": 2 },
    { "label": "AMD Ryzen 5 5000", "pattern": "\\b(?:ryzen[\\s®™_-]*5|r5)[\\s-]?5\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b5000\\b)", "flags": "i", "tier": 1 }
  ]'::jsonb
)
where id = 1;

-- 2) Marcas de "falta info, revisar a mano" — nunca excluyen la oferta,
--    solo la señalan para que la revises vos (ver domain/types.ts EvaluatedDeal).
alter table public.seen_listings
  add column if not exists has_description boolean not null default true,
  add column if not exists has_battery_info boolean not null default true;

-- CREATE OR REPLACE no puede insertar columnas en el medio de una vista
-- existente (solo al final), así que la recreamos entera.
drop view if exists public.deals_public;

create view public.deals_public as
select
  item_id,
  title,
  price,
  currency,
  condition,
  cpu_match,
  score,
  is_great_deal,
  has_description,
  has_battery_info,
  url,
  image_url,
  first_seen_at
from public.seen_listings
where qualified = true;

grant select on public.deals_public to anon, authenticated;

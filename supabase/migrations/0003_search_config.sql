-- Config de búsqueda editable en runtime (sin redeployar la función).
-- El objeto JSON sembrado acá es exactamente DEFAULT_SEARCH_CONFIG de
-- supabase/functions/_shared/domain/default-config.ts — son los filtros por
-- defecto que se usaron al armar el bot y quedan como punto de partida.
-- Para ajustarlos: `update public.search_config set config = config || '{"maxPriceUsd": 180}'::jsonb where id = 1;`

create table if not exists public.search_config (
  id int primary key default 1,
  config jsonb not null,
  updated_at timestamptz not null default now(),
  constraint search_config_single_row check (id = 1)
);

alter table public.search_config enable row level security;
-- Solo el service role (Edge Function) lee/escribe esto; no hay policies para anon/authenticated.

insert into public.search_config (id, config)
values (
  1,
  '{
    "marketplaceId": "EBAY_US",
    "categoryId": "177",
    "maxPriceUsd": 200,
    "greatDealMaxPrice": 160,
    "greatDealMinScore": 80,
    "includedConditionIds": [1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000],
    "includeAuctions": false,
    "maxPages": 2,
    "maxCandidatesPerRun": 25,
    "minBatteryPercent": 70,
    "cpuPatterns": [
      { "label": "Intel i7 11th gen", "pattern": "\\bi7[\\s-]?11\\d{2}[a-z]{0,2}\\b", "flags": "i", "tier": 6 },
      { "label": "Intel i5 12th gen", "pattern": "\\bi5[\\s-]?12\\d{2}[a-z]{0,2}\\b", "flags": "i", "tier": 5 },
      { "label": "Intel i7 10th gen", "pattern": "\\bi7[\\s-]?10\\d{2}[a-z]{0,2}\\b", "flags": "i", "tier": 4 },
      { "label": "AMD Ryzen 7 4000", "pattern": "ryzen\\s*7\\s*4\\d{3}[a-z]{0,2}\\b", "flags": "i", "tier": 3 },
      { "label": "Intel i5 11th gen", "pattern": "\\bi5[\\s-]?11\\d{2}[a-z]{0,2}\\b", "flags": "i", "tier": 2 },
      { "label": "AMD Ryzen 5 5000", "pattern": "ryzen\\s*5\\s*5\\d{3}[a-z]{0,2}\\b", "flags": "i", "tier": 1 }
    ],
    "excludePatterns": [
      { "reason": "for_parts_or_not_working", "pattern": "for\\s*parts|not\\s*working|parts\\s*only|parts[\\s\\/]*repair|no\\s*enciende|no\\s*prende|no\\s*power", "flags": "i" },
      { "reason": "missing_storage", "pattern": "no\\s*(hard\\s*drive|hdd|ssd|storage)|missing\\s*(hard\\s*drive|hdd|ssd|storage)|without\\s*(hard\\s*drive|hdd|ssd|storage)|sin\\s*disco(\\s*duro)?|sin\\s*almacenamiento", "flags": "i" },
      { "reason": "missing_battery", "pattern": "no\\s*battery|missing\\s*battery|battery\\s*not\\s*included|without\\s*battery|sin\\s*bateria|sin\\s*batería", "flags": "i" },
      { "reason": "battery_fair_or_worse", "pattern": "batt(?:ery)?\\s*(health|condition)?\\s*[:\\-]?\\s*(fair|poor|bad)\\b", "flags": "i" }
    ]
  }'::jsonb
)
on conflict (id) do nothing;

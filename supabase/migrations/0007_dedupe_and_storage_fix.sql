-- 1) Huella para colapsar republicaciones del mismo equipo. Hay vendedores que
--    suben la misma laptop 10 veces cambiando solo un carácter del título
--    ("... NO HD", "... NO HD *", "... NO HD ~"). La normalización tiene que
--    coincidir con listingFingerprint() en domain/hardware-signals.ts:
--    título en minúsculas, sin nada que no sea a-z0-9, + "|" + precio redondeado.
alter table public.seen_listings
  add column if not exists fingerprint text;

update public.seen_listings
set fingerprint = regexp_replace(lower(title), '[^a-z0-9]', '', 'g')
  || '|' || coalesce(round(price), 0)::bigint::text
where fingerprint is null;

create index if not exists seen_listings_fingerprint_idx
  on public.seen_listings (fingerprint)
  where qualified = true;

alter table public.hunt_runs
  add column if not exists duplicates_skipped int not null default 0;

-- 2) "missing_storage" dejó de ser un patrón de config: ahora es regla de
--    código, porque necesita cruzar la frase ("NO HD", "no hdd", "sin disco")
--    con la ausencia de una capacidad concreta, para no descartar un
--    "512GB SSD, no HDD" que sí tiene disco.
update public.search_config
set config = jsonb_set(
  config,
  '{excludePatterns}',
  (
    select coalesce(jsonb_agg(p), '[]'::jsonb)
    from jsonb_array_elements(config->'excludePatterns') as p
    where p->>'reason' <> 'missing_storage'
  )
)
where id = 1;

-- 3) Limpieza de lo ya guardado con las reglas viejas: los que entraron sin
--    disco (el regex anterior no reconocía "NO HD") y las republicaciones
--    duplicadas, dejando solo la primera vista de cada huella.
update public.seen_listings
set qualified = false, reject_reason = 'missing_storage'
where qualified = true
  and title ~* '\m(no|without|missing|sin)\s*(hard\s*(drive|disk)|hdd|hd|ssd|nvme|storage|drive|disco)\M'
  and title !~* '\m[0-9]{3,4}\s*gb\M'
  and title !~* '\m[0-9]\s*tb\M';

with ranked as (
  select item_id,
         row_number() over (partition by fingerprint order by first_seen_at, item_id) as rn
  from public.seen_listings
  where qualified = true
)
update public.seen_listings s
set qualified = false, reject_reason = 'duplicate_listing'
from ranked r
where s.item_id = r.item_id and r.rn > 1;

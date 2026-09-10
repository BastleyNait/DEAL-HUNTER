-- Recalcula las huellas con la misma normalización que listingFingerprint()
-- después de agregarle el colapso de pulgadas (13.3in / 13.3 inch / 13.3" son
-- la misma medida, y es la variación más común entre republicaciones).
-- Postgres usa \M (fin de palabra), no \b.

update public.seen_listings
set fingerprint = regexp_replace(
      regexp_replace(lower(title), '(\d)\s*(inches|inch|in)\M', '\1', 'g'),
      '[^a-z0-9]', '', 'g'
    ) || '|' || coalesce(round(price), 0)::bigint::text;

-- Vuelve a colapsar duplicados con las huellas nuevas, dejando la primera vista.
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

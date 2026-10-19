-- Cola de "compradas por publicar".
--
-- Tocar "🛒 La compro" en Telegram registra la compra acá (y también se puede
-- agregar un link a mano desde el dashboard), así ya no hay que pegar el link
-- en Publicar: la cola lo muestra con su título y precio, y el texto de venta
-- se genera recién cuando se abre el ítem (de a uno, para no saturar eBay) y
-- queda guardado en `draft` para las próximas veces.
--
-- - legacy_id: el número de la publicación de eBay (el de la URL /itm/...).
-- - item_id: el id de la Browse API ("v1|<legacy>|0"), el mismo de
--   seen_listings y publications: con eso se cruza título/precio/foto y si ya
--   se publicó.
-- - dismissed_at: quitada de la cola a mano (no se borra, queda el registro).
-- Sin policies: escriben las Edge Functions con la service role; el dashboard
-- lee la vista purchases_public.

create table if not exists public.purchases (
  legacy_id    text primary key,
  item_id      text not null,
  url          text not null,
  source       text not null default 'manual' check (source in ('telegram', 'manual')),
  bought_by    text,
  bought_at    timestamptz not null default now(),
  draft        jsonb,
  draft_at     timestamptz,
  dismissed_at timestamptz
);
alter table public.purchases enable row level security;

create or replace view public.purchases_public as
select p.legacy_id, p.item_id, p.url, p.source, p.bought_by, p.bought_at,
       p.draft is not null as has_draft,
       coalesce(s.title, p.draft->>'title') as title,
       s.price, s.image_url,
       pub.store_slug, pub.facebook_status
  from public.purchases p
  left join public.seen_listings s on s.item_id = p.item_id
  left join public.publications pub on pub.item_id = p.item_id
 where p.dismissed_at is null;

grant select on public.purchases_public to anon, authenticated;

-- Publicación en un click: de una oferta de eBay a la tienda propia (y, a
-- futuro, a Facebook Marketplace vía el worker local de Playwright).
--
-- item_id NO referencia seen_listings: el flujo de "pegar un link de algo que
-- ya compré" resuelve el detalle directo contra eBay y puede publicar equipos
-- que el cazador nunca vio (por ejemplo, comprados buscando a mano). La FK
-- rompería justo el caso de uso que se pidió.

create table if not exists public.publications (
  item_id               text primary key,
  ebay_url              text not null,
  title                 text not null,
  description           text not null,
  price_usd             numeric(10, 2) not null,
  cost_usd              numeric(10, 2) not null,
  currency              text not null default 'USD',
  image_urls            jsonb not null default '[]'::jsonb,
  store_product_id      uuid,
  store_slug            text,
  store_published_at    timestamptz,
  -- Cola para el worker de Facebook: nadie escribe 'posted' salvo el worker.
  facebook_status       text not null default 'none'
                           check (facebook_status in ('none', 'queued', 'posted', 'failed', 'skipped')),
  facebook_posted_at    timestamptz,
  facebook_error        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create or replace function public.publications_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists publications_set_updated_at on public.publications;
create trigger publications_set_updated_at
  before update on public.publications
  for each row execute function public.publications_set_updated_at();

alter table public.publications enable row level security;

-- Sin policies para anon/authenticated: se escribe únicamente desde la Edge
-- Function con la service role. El dashboard lee a través de la vista pública
-- de abajo, que no expone costo, descripción completa ni el arreglo de fotos.

-- ---------------------------------------------------------------------------
-- Lo que el dashboard necesita para saber "esto ya está publicado" y mostrar
-- una insignia en la tarjeta, sin exponer costos ni el estado interno del
-- worker de Facebook en detalle.
-- ---------------------------------------------------------------------------
create or replace view public.publications_public as
select item_id, store_slug, store_published_at, facebook_status, facebook_posted_at
  from public.publications;

grant select on public.publications_public to anon, authenticated;

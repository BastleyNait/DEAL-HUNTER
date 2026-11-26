-- Interruptor "Auto-publicar" del dashboard: con true, el publicador de
-- Facebook publica sin esperar el click en Publicar. Vive en la misma fila de
-- estado (el latido no lo pisa: el upsert solo escribe sus propias columnas).
alter table public.publisher_status
  add column if not exists auto_publish boolean not null default false;

-- Columna nueva al final: create or replace view solo permite agregar.
create or replace view public.publisher_status_public as
select last_seen, state, current_title, auto_publish
  from public.publisher_status;

grant select on public.publisher_status_public to anon, authenticated;

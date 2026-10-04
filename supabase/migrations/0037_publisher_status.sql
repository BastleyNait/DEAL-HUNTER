-- Estado del publicador de Facebook, para verlo desde el dashboard.
--
-- El publicador (repo DEAL PUBLISHER) corre en tu PC con un navegador real, y
-- el dashboard está en la nube: una página web no puede abrir un programa de
-- tu PC ni saber si está encendido. El publicador avisa acá cada ~10 s, y el
-- dashboard lo lee para mostrar "en línea / apagado" y qué está haciendo.
--
-- Una sola fila (id = 1): hay un solo publicador a la vez, porque dos
-- instancias no pueden compartir el perfil de Chromium con tu sesión de
-- Facebook. last_seen también sirve de candado: al arrancar, un publicador
-- que ve un latido fresco avisa "ya hay uno corriendo" y no abre otro.

create table if not exists public.publisher_status (
  id           integer primary key default 1 check (id = 1),
  last_seen    timestamptz not null default now(),
  -- idle: esperando trabajo | working: llenando el formulario
  -- waiting_confirm: formulario completo, esperando tu click en Facebook
  state        text not null default 'idle' check (state in ('idle', 'working', 'waiting_confirm')),
  current_item text,
  current_title text,
  started_at   timestamptz not null default now()
);

alter table public.publisher_status enable row level security;
-- Sin policies: solo escribe el publicador con la service role.

create or replace view public.publisher_status_public as
select last_seen, state, current_title
  from public.publisher_status;

grant select on public.publisher_status_public to anon, authenticated;

-- El panel de cola necesita mostrar qué publicación es cada una. Columna
-- nueva al final: create or replace view solo permite agregar. El título es
-- el mismo texto que ya está público en la tienda; el costo y el error del
-- worker (que puede traer rutas de tu PC) siguen sin exponerse.
create or replace view public.publications_public as
select item_id, store_slug, store_published_at, facebook_status, facebook_posted_at, title
  from public.publications;

grant select on public.publications_public to anon, authenticated;

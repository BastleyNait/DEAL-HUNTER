-- Quién recibe los avisos de Telegram, con aprobar/quitar en vivo en vez de
-- editar una secret a mano cada vez. TELEGRAM_CHAT_ID (la secret que ya
-- existía) pasa a ser solo la semilla de arranque: el primero de la lista se
-- vuelve "dueño" (autorizado a aprobar/rechazar), y de ahí en adelante todo
-- se maneja acá.

create table if not exists public.telegram_recipients (
  chat_id      text primary key,
  name         text,
  username     text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  is_owner     boolean not null default false,
  requested_at timestamptz not null default now(),
  decided_at   timestamptz
);

alter table public.telegram_recipients enable row level security;
-- Sin policies para anon/authenticated: solo lo tocan las Edge Functions con
-- la service role (el webhook de Telegram y el canal de notificación).

-- Reaccionar a una alerta desde Telegram: "🛒 La compro" / "👎 Paso".
--
-- Cada persona recibe la alerta en su chat privado con el bot, así que una
-- reacción común de Telegram solo la ve quien la pone. Con estos botones el
-- bot edita la alerta en el chat de TODOS ("🛒 Sebastián la está comprando"),
-- y si alguien ya la está comprando, otro no puede marcarla: nunca compran dos
-- la misma laptop.
--
-- - telegram_alert_messages: qué mensaje se mandó a qué chat por cada
--   publicación, con su texto, para poder editarlos todos juntos.
-- - deal_reactions: la reacción de cada persona a cada publicación (una por
--   persona; tocar el mismo botón otra vez la borra).
-- Sin policies: solo las tocan las Edge Functions con la service role.

create table if not exists public.telegram_alert_messages (
  item_id    text not null,
  chat_id    text not null,
  message_id bigint not null,
  text       text not null,
  sent_at    timestamptz not null default now(),
  primary key (item_id, chat_id)
);
alter table public.telegram_alert_messages enable row level security;

create table if not exists public.deal_reactions (
  item_id    text not null,
  chat_id    text not null,
  name       text,
  reaction   text not null check (reaction in ('buy', 'skip')),
  reacted_at timestamptz not null default now(),
  primary key (item_id, chat_id)
);
alter table public.deal_reactions enable row level security;

-- Una sola persona puede estar comprando cada publicación.
create unique index if not exists deal_reactions_one_buyer
  on public.deal_reactions (item_id) where reaction = 'buy';

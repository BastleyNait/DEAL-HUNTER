-- El publicador de Facebook postea cada laptop en varias ciudades (Lima,
-- Arequipa, Moquegua...). Acá se anota en cuáles ya quedó publicada: si falla
-- a mitad, al reintentar sigue con las que faltan sin repetir ninguna.
alter table public.publications
  add column if not exists facebook_posted_locations text[] not null default '{}';

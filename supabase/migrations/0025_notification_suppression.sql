-- Telegram deja de avisar dos veces del mismo equipo.
--
-- Había tres agujeros:
--
--  1. `deal_views` (lo que marcás como visto en el dashboard) la escribía el
--     frontend y no la leía nadie más. "Visto" solo apagaba la tarjeta.
--  2. `listingFingerprint` incluye el precio, así que un vendedor que
--     republica el mismo equipo a $174.99 en vez de $179.99 pasaba el filtro
--     de duplicados como si fuera otra máquina.
--  3. `notified_at` se escribía al guardar, antes de mandar nada, así que
--     significaba "calificó" y no servía para saber de qué ya se avisó.
--
-- Acá se arregla (1) y (2) con una clave que identifica la máquina sin el
-- precio. (3) se arregla en el código: `notified_at` pasa a escribirse recién
-- cuando el envío salió bien.

-- ---------------------------------------------------------------------------
-- La clave de supresión
-- ---------------------------------------------------------------------------
-- Vendedor + título normalizado, sin precio. Incluye al vendedor a propósito:
-- si otro publica la misma ThinkPad más barata querés enterarte; lo que sobra
-- es que el mismo vendedor te la vuelva a ofrecer.
--
-- Del título se sacan las palabras que los vendedores retocan entre
-- republicaciones (grade a, refurbished, fast shipping, win11 pro) y que no
-- cambian qué máquina es. Lo que describe al equipo — modelo, CPU, GB — queda
-- intacto, así que dos configuraciones distintas siguen siendo dos claves.
create or replace function public.listing_model_key(p_title text, p_seller text)
returns text
language sql
immutable
as $$
  select lower(coalesce(p_seller, '?')) || '|' || regexp_replace(
    regexp_replace(
      regexp_replace(
        lower(coalesce(p_title, '')),
        -- 13.3in / 13.3 inch / 13.3" son la misma medida escrita distinto.
        '(\d)\s*(inches|inch|in)\y', '\1', 'g'
      ),
      '\y(grade\s*[a-c]\+?'
      || '|fully\s*refurbished|refurbished|refurb|renewed'
      || '|pre[\s-]*owned|used'
      || '|excellent|very\s*good|great|good|fair|mint|clean|nice'
      || '|condition|cosmetic|wear'
      || '|(fast|free|same\s*day)\s*(shipping|ship)'
      || '|tested|working|works|functional'
      || '|warranty|genuine|oem|authentic'
      || '|laptop|notebook|ultrabook|computer'
      || '|read\s*description|see\s*description|as\s*is'
      || '|win(dows)?\s*1[01](\s*(pro|home))?'
      || '|bundle|lot)\y',
      ' ', 'g'
    ),
    -- Todo lo que no sea letra o número se cae: espacios de más, guiones,
    -- comillas y emojis son ruido de redacción, no señal.
    '[^a-z0-9]', '', 'g'
  );
$$;

comment on function public.listing_model_key(text, text) is
  'Identifica una máquina sin el precio, para no avisar dos veces de la misma.';

-- ---------------------------------------------------------------------------
-- La columna, mantenida por trigger
-- ---------------------------------------------------------------------------
-- Trigger y no columna generada: una columna generada congela la función, y la
-- normalización se va a querer ajustar a medida que aparezcan republicaciones
-- que se escapan. Así se cambia la función y se corre el backfill de nuevo.
alter table public.seen_listings add column if not exists model_key text;

create or replace function public.seen_listings_set_model_key()
returns trigger
language plpgsql
as $$
begin
  new.model_key := public.listing_model_key(new.title, new.seller_username);
  return new;
end;
$$;

drop trigger if exists seen_listings_model_key on public.seen_listings;
create trigger seen_listings_model_key
  before insert or update on public.seen_listings
  for each row execute function public.seen_listings_set_model_key();

-- Backfill: sin esto la supresión arrancaría sin memoria y las ThinkPads que
-- ya se avisaron tres veces se avisarían una cuarta.
update public.seen_listings
   set model_key = public.listing_model_key(title, seller_username)
 where model_key is distinct from public.listing_model_key(title, seller_username);

create index if not exists seen_listings_model_key_idx
  on public.seen_listings (model_key);

-- ---------------------------------------------------------------------------
-- El filtro que usa el cazador antes de notificar
-- ---------------------------------------------------------------------------
-- Devuelve, de los ítems dados, cuáles todavía no se avisaron: los que no
-- comparten clave con nada que ya hayas visto en el dashboard o que ya se haya
-- mandado a Telegram. Devuelve también la clave para que la aplicación pueda
-- colapsar los repetidos dentro de una misma corrida.
--
-- Es `stable` y `security invoker`: corre con los permisos de quien llama, y
-- como `seen_listings` no tiene policies para anon, desde el navegador no
-- devuelve nada. El cazador la llama con la service role.
create or replace function public.filter_notifiable(p_item_ids text[])
returns table (item_id text, model_key text)
language sql
stable
as $$
  select l.item_id, l.model_key
    from public.seen_listings l
   where l.item_id = any (p_item_ids)
     and not exists (
       select 1
         from public.seen_listings prior
         left join public.deal_views v on v.item_id = prior.item_id
        where prior.model_key = l.model_key
          and (v.item_id is not null or prior.notified_at is not null)
     );
$$;

comment on function public.filter_notifiable(text[]) is
  'De los ítems dados, los que no se avisaron ni se marcaron como vistos.';

-- El worker de Facebook llenaba el campo Precio con price_usd tal cual (ej.
-- 420), y como la cuenta de Facebook está en Perú, el formulario lo mostraba
-- como S/ 420 en vez de convertirlo — el equivalente a vender un producto de
-- $420 a S/ 420 (~3.7 veces menos). publications nunca guardó el precio ya
-- convertido: solo se calculaba al vuelo para el campo `price` de REVOLT-LAP
-- (en soles) y se perdía ahí. Se agrega la columna, y se completa lo que ya
-- estaba en la tabla con el tipo de cambio configurado.

alter table public.publications
  add column if not exists price_pen numeric(10, 2);

update public.publications p
   set price_pen = round(p.price_usd * coalesce((s.config->>'publishUsdToPenRate')::numeric, 3.7))
  from public.search_config s
 where s.id = 1
   and p.price_pen is null;

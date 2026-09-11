-- La desduplicación de 0023 no agarró "1245u" porque estaba dos veces con
-- distinto sort, así que `distinct` las consideró objetos diferentes. Como
-- ambas quedaron en 3 páginas, eran 6 páginas por ciclo sobre la misma query.
-- Se conserva la ordenada por precio, que es la que mina las más baratas.

update public.search_config
set config = jsonb_set(
  config,
  '{searchProfiles}',
  (
    select coalesce(jsonb_agg(p), '[]'::jsonb)
    from jsonb_array_elements(config->'searchProfiles') as p
    where not (p->>'query' = '1245u' and p->>'sort' = 'newlyListed')
  )
)
where id = 1;

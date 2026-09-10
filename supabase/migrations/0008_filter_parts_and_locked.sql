-- Buscar por número de modelo de CPU trae muchos repuestos sueltos
-- (ventiladores, motherboards, pantallas) y equipos con BIOS bloqueado. Al ser
-- baratísimos quedaban primeros en el ranking como si fueran ofertazas.

update public.search_config
set config = config || jsonb_build_object('minFixedPriceUsd', 25)
where id = 1;

-- Limpieza de lo ya guardado bajo las reglas viejas.
update public.seen_listings
set qualified = false, reject_reason = 'not_a_usable_laptop'
where qualified = true
  and title ~* '\m(motherboard|mainboard|system\s*board|logic\s*board|palm\s*rest|palmrest|heat\s*sink|heatsink|fan|cooler|hinge|bezel|ribbon|bios\s*(is\s*)?(locked|password))\M';

update public.seen_listings
set qualified = false, reject_reason = 'price_too_low_for_a_laptop'
where qualified = true
  and coalesce(is_auction, false) = false
  and price is not null
  and price < 25;

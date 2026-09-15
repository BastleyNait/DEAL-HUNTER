/**
 * Precio de venta sugerido: (costo en eBay + flete/import fijo) × margen.
 * Los dos números salen de SearchConfig (publishMarkupFlatUsd,
 * publishMarkupMultiplier) para poder ajustarlos desde la tabla search_config
 * sin redeployar — igual que el resto de los parámetros de la caza.
 */
export function computeSalePriceUsd(costUsd: number, flatUsd: number, multiplier: number): number {
  const raw = (costUsd + flatUsd) * multiplier;
  // Redondeado al dólar: un precio con centavos no aporta nada acá y complica
  // la lectura rápida en el panel de publicación.
  return Math.round(raw);
}

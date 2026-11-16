/**
 * Puntaje de estación de trabajo (ESPECIAL GPU): relativo a la clase de la
 * gráfica y al precio. El puntaje general casi no mira ninguna de las dos (el
 * precio pesa 10% y todo lo que pasa de $200 ya saca 0 ahí), así que una T550
 * a $495 sacaba 100 y una P15v con P620 a menos de $200 —la mejor compra
 * hasta ahora— sacaba menos.
 *
 *   65%  precio contra la banda de su clase (100 en "buen precio" o menos, 0 en "caro" o más)
 *   15%  clase de gráfica (entrada 25, media 50, alta 75, tope 100)
 *   20%  puntaje general (CPU, RAM, disco, estado)
 *
 * Bandas sacadas de los precios de compra directa vistos en eBay (nov 2026):
 * entrada, mediana $240 y p10 $160; media, mediana $390.
 *
 * COPIA en DEAL WEB/src/domain/workstationScore.ts: si se cambia acá, se cambia allá.
 */
export type GpuClass = 1 | 2 | 3 | 4;

const CLASS_RES: [GpuClass, RegExp][] = [
  [4, /rtx a[3-5]\d{3}|quadro rtx [45]000|rtx (?:2070|2080|3070|3080|40[6-9]0)|p[45]200/i],
  [3, /rtx a2000|quadro rtx 3000|t2000|p3200|rtx (?:2060|3060|4050)|gtx 10[78]0/i],
  [2, /t1000|t1200|p1000|p2000|rtx a1000|\ba500|gtx 1660|rtx (?:3050|2050)|gtx 1060|gtx 1650 ti/i],
];

/** Clase de la gráfica por su nombre guardado. "Según el modelo" (no se sabe cuál) va como entrada. */
export function gpuClass(label: string | null): GpuClass {
  if (!label) return 1;
  for (const [c, re] of CLASS_RES) if (re.test(label)) return c;
  return 1;
}

/** [buen precio, caro] por clase. */
const PRICE_BANDS: Record<GpuClass, [number, number]> = {
  1: [180, 300],
  2: [200, 450],
  3: [250, 500],
  4: [320, 600],
};

/**
 * En una subasta el precio es la puja actual, no el final: haría parecer todo
 * una ganga. Ahí la parte de precio va neutra (la mitad) hasta que cierre.
 */
export function workstationScore(
  price: number | null,
  gpuLabel: string | null,
  baseScore: number | null,
  isAuction = false,
): number {
  const cls = gpuClass(gpuLabel);
  const [good, bad] = PRICE_BANDS[cls];
  const priceValue = isAuction ? 0.5 : price == null ? 0 : Math.max(0, Math.min(1, (bad - price) / (bad - good)));
  const score = 65 * priceValue + 15 * (cls / 4) + 0.2 * (baseScore ?? 0);
  return Math.round(Math.max(0, Math.min(100, score)));
}

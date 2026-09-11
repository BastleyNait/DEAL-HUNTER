import type { ListingDetail, ModelTierConfig, ScoreFactor, ScoringContext } from "../domain/types.ts";
import { extractBatteryPercent, extractRamGb, extractStorageGb } from "../domain/hardware-signals.ts";

/**
 * "Used" es el estado esperado del negocio, no un defecto: casi todo lo que se
 * compra viene así. Penalizarlo fuerte hacía que ninguna compra buena pudiera
 * acercarse al tope de la escala. Lo que sí penaliza de verdad es "Acceptable".
 */
const CONDITION_WEIGHTS: Record<string, number> = {
  "New": 1,
  "New other (see details)": 0.95,
  "Certified - Refurbished": 0.95,
  "Excellent - Refurbished": 0.92,
  "Very Good - Refurbished": 0.9,
  "Seller refurbished": 0.85,
  "Very Good": 0.9,
  "Good": 0.82,
  "Used": 0.8,
  "Acceptable": 0.45,
};

/**
 * El precio pesa poco a propósito. Las compras reales fueron de $154 a $200,
 * ninguna por debajo: lo que se busca es la mejor máquina que entre en el
 * presupuesto, no la más barata. Con el precio dominando el puntaje, la
 * chatarra de $50 encabezaba la lista y enterraba justo lo que sí se compra.
 * Igual se reconoce el margen, pero se aplana por debajo de la mitad del tope.
 */
export const priceFactor: ScoreFactor = {
  id: "price",
  weight: 0.1,
  score(listing: ListingDetail, ctx: ScoringContext) {
    if (listing.price == null) return 0;
    const margin = (ctx.maxPriceUsd - listing.price) / (ctx.maxPriceUsd * 0.45);
    return Math.max(0, Math.min(1, margin));
  },
};

/** Tier de CPU (definido en config.cpuPatterns), normalizado 0.5..1. */
export const cpuTierFactor: ScoreFactor = {
  id: "cpu_tier",
  weight: 0.24,
  score(_listing: ListingDetail, ctx: ScoringContext) {
    if (ctx.maxCpuTier <= 1) return 1;
    return 0.5 + 0.5 * ((ctx.cpuTier - 1) / (ctx.maxCpuTier - 1));
  },
};

export const conditionFactor: ScoreFactor = {
  id: "condition",
  weight: 0.12,
  score(listing: ListingDetail) {
    if (!listing.condition) return 0.5;
    return CONDITION_WEIGHTS[listing.condition] ?? 0.5;
  },
};

export const batteryFactor: ScoreFactor = {
  id: "battery",
  weight: 0.08,
  score(listing: ListingDetail) {
    const pct = extractBatteryPercent(`${listing.title} ${listing.descriptionText}`);
    // La mayoría de las publicaciones no dicen nada de la batería, así que no
    // saberlo no puede costar la mitad del factor.
    if (pct === null) return 0.6;
    return Math.max(0, Math.min(1, (pct - 70) / 30));
  },
};

/**
 * La RAM pesa casi tanto como la CPU: 5 de las 6 compras reales fueron de
 * 16GB. Es un requisito de hecho, no un extra, y con el peso viejo (5%) una
 * máquina de 8GB podía quedar arriba de una de 16GB equivalente.
 */
export const ramFactor: ScoreFactor = {
  id: "ram",
  weight: 0.2,
  score(listing: ListingDetail) {
    const gb = extractRamGb(`${listing.title} ${listing.descriptionText}`);
    if (gb >= 16) return 1;
    if (gb >= 12) return 0.6;
    if (gb >= 8) return 0.4;
    return 0;
  },
};

/**
 * 256GB no penaliza: es lo que traían 5 de las 6 compras. Lo que penaliza es
 * menos que eso.
 */
export const storageFactor: ScoreFactor = {
  id: "storage",
  weight: 0.08,
  score(listing: ListingDetail) {
    const gb = extractStorageGb(`${listing.title} ${listing.descriptionText}`);
    if (gb >= 512) return 1;
    if (gb >= 256) return 0.85;
    if (gb >= 128) return 0.3;
    return 0;
  },
};

/**
 * Qué tan fácil es revender ese modelo. Pesa casi como la RAM porque en la
 * práctica decide si el equipo se va rápido o se queda en el estante: dos
 * máquinas con la misma ficha técnica no valen lo mismo si una es ThinkPad y la
 * otra una línea de consumo.
 *
 * El escalafón sale de la config (ver default-config.ts para el criterio).
 */
export function createModelFactor(tiers: ModelTierConfig[], fallbackWeight: number): ScoreFactor {
  const compiled = tiers.map((tier) => ({ weight: tier.weight, regex: new RegExp(tier.pattern, tier.flags) }));

  return {
    id: "model",
    weight: 0.18,
    score(listing: ListingDetail) {
      // Gana el primero que matchea: el escalafón está ordenado de mejor a peor.
      const match = compiled.find((tier) => tier.regex.test(listing.title));
      return match ? match.weight : fallbackWeight;
    },
  };
}

export const DEFAULT_SCORE_FACTORS: ScoreFactor[] = [
  priceFactor,
  cpuTierFactor,
  conditionFactor,
  batteryFactor,
  ramFactor,
  storageFactor,
];

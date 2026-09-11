import type { ListingDetail, ScoreFactor, ScoringContext } from "../domain/types.ts";
import { extractBatteryPercent, extractRamGb, extractStorageGb } from "../domain/hardware-signals.ts";

const CONDITION_WEIGHTS: Record<string, number> = {
  "New": 1,
  "New other (see details)": 0.95,
  "Certified - Refurbished": 0.9,
  "Excellent - Refurbished": 0.9,
  "Very Good - Refurbished": 0.85,
  "Seller refurbished": 0.8,
  "Very Good": 0.85,
  "Good": 0.7,
  "Used": 0.6,
  "Acceptable": 0.4,
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
  weight: 0.14,
  score(listing: ListingDetail, ctx: ScoringContext) {
    if (listing.price == null) return 0;
    const margin = (ctx.maxPriceUsd - listing.price) / (ctx.maxPriceUsd * 0.45);
    return Math.max(0, Math.min(1, margin));
  },
};

/** Tier de CPU (definido en config.cpuPatterns), normalizado 0.5..1. */
export const cpuTierFactor: ScoreFactor = {
  id: "cpu_tier",
  weight: 0.28,
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
  weight: 0.1,
  score(listing: ListingDetail) {
    const pct = extractBatteryPercent(`${listing.title} ${listing.descriptionText}`);
    if (pct === null) return 0.5; // sin dato: neutral, no penaliza ni premia
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
  weight: 0.24,
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
  weight: 0.07,
  score(listing: ListingDetail) {
    const gb = extractStorageGb(`${listing.title} ${listing.descriptionText}`);
    if (gb >= 512) return 1;
    if (gb >= 256) return 0.85;
    if (gb >= 128) return 0.3;
    return 0;
  },
};

/**
 * Línea corporativa delgada (ThinkPad, Portégé, Latitude, EliteBook...). Las 6
 * compras reales fueron 4 ThinkPad y 2 Dynabook Portégé: se revenden rápido y
 * tienen repuestos. La lista sale de la config, así que se ajusta sin redeploy.
 */
export function createModelFactor(preferredModels: string[]): ScoreFactor {
  const regex = preferredModels.length
    ? new RegExp(`\\b(?:${preferredModels.join("|")})\\b`, "i")
    : null;

  return {
    id: "model",
    weight: 0.05,
    score(listing: ListingDetail) {
      if (!regex) return 0.5;
      return regex.test(listing.title) ? 1 : 0.35;
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

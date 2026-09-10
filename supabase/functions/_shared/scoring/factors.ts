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

/** Cuanto más lejos el precio del tope configurado, mejor. */
export const priceFactor: ScoreFactor = {
  id: "price",
  weight: 0.4,
  score(listing: ListingDetail, ctx: ScoringContext) {
    if (listing.price == null) return 0;
    return Math.max(0, Math.min(1, (ctx.maxPriceUsd - listing.price) / ctx.maxPriceUsd));
  },
};

/** Tier de CPU (definido en config.cpuPatterns), normalizado 0.5..1. */
export const cpuTierFactor: ScoreFactor = {
  id: "cpu_tier",
  weight: 0.2,
  score(_listing: ListingDetail, ctx: ScoringContext) {
    if (ctx.maxCpuTier <= 1) return 1;
    return 0.5 + 0.5 * ((ctx.cpuTier - 1) / (ctx.maxCpuTier - 1));
  },
};

export const conditionFactor: ScoreFactor = {
  id: "condition",
  weight: 0.15,
  score(listing: ListingDetail) {
    if (!listing.condition) return 0.5;
    return CONDITION_WEIGHTS[listing.condition] ?? 0.5;
  },
};

export const batteryFactor: ScoreFactor = {
  id: "battery",
  weight: 0.15,
  score(listing: ListingDetail) {
    const pct = extractBatteryPercent(`${listing.title} ${listing.descriptionText}`);
    if (pct === null) return 0.5; // sin dato: neutral, no penaliza ni premia
    return Math.max(0, Math.min(1, (pct - 70) / 30));
  },
};

// Tiers explícitos pedidos: 8GB y 16GB de RAM.
export const ramFactor: ScoreFactor = {
  id: "ram",
  weight: 0.05,
  score(listing: ListingDetail) {
    const gb = extractRamGb(`${listing.title} ${listing.descriptionText}`);
    if (gb >= 16) return 1;
    if (gb >= 8) return 0.5;
    return 0;
  },
};

// Tiers explícitos pedidos: 256GB y 512GB de almacenamiento (1TB+ cuenta como el tope).
export const storageFactor: ScoreFactor = {
  id: "storage",
  weight: 0.05,
  score(listing: ListingDetail) {
    const gb = extractStorageGb(`${listing.title} ${listing.descriptionText}`);
    if (gb >= 512) return 1;
    if (gb >= 256) return 0.5;
    return 0;
  },
};

export const DEFAULT_SCORE_FACTORS: ScoreFactor[] = [
  priceFactor,
  cpuTierFactor,
  conditionFactor,
  batteryFactor,
  ramFactor,
  storageFactor,
];

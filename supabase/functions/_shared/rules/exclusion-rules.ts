import type { ExclusionRule, ListingDetail, SearchConfig } from "../domain/types.ts";
import {
  extractBatteryPercent,
  extractStorageGb,
  looksLikePartOrLocked,
  mentionsNoStorage,
} from "../domain/hardware-signals.ts";

/**
 * Una regla por cada `excludePatterns` del config (data-driven: agregar una
 * frase de descarte nueva es editar la config, no tocar código — Open/Closed).
 */
function patternRules(config: SearchConfig): ExclusionRule[] {
  return config.excludePatterns.map((p) => {
    const regex = new RegExp(p.pattern, p.flags);
    return {
      id: p.reason,
      evaluate(listing: ListingDetail) {
        const text = `${listing.title} ${listing.descriptionText}`;
        return { excluded: regex.test(text), reason: p.reason };
      },
    };
  });
}

/**
 * Repuestos sueltos y equipos bloqueados. Buscar por número de modelo de CPU
 * trae muchos componentes (ventiladores, motherboards, pantallas) que, al ser
 * baratísimos, se colarían justo arriba de la lista como si fueran ofertazas.
 */
function partOrLockedRule(): ExclusionRule {
  return {
    id: "not_a_usable_laptop",
    evaluate(listing: ListingDetail) {
      if (!looksLikePartOrLocked(listing.title)) return { excluded: false };
      return { excluded: true, reason: "not_a_usable_laptop" };
    },
  };
}

/**
 * Precio de lista implausible para un equipo completo. Solo aplica a precio
 * fijo: en subasta un precio inicial de $1 es normal y no dice nada malo.
 */
function implausiblePriceRule(config: SearchConfig): ExclusionRule {
  return {
    id: "price_too_low_for_a_laptop",
    evaluate(listing: ListingDetail) {
      if (listing.price == null || listing.buyingOptions.includes("AUCTION")) return { excluded: false };
      if (listing.price >= config.minFixedPriceUsd) return { excluded: false };
      return { excluded: true, reason: "price_too_low_for_a_laptop" };
    },
  };
}

/**
 * Sin almacenamiento. Es regla de código y no un patrón de config porque cruza
 * dos señales: que el texto diga "no HD/HDD/SSD/disco" Y que además no aparezca
 * ninguna capacidad concreta. Así no se descarta un "512GB SSD, no HDD" (que sí
 * tiene disco) pero sí un "16GB RAM NO HD" (que no).
 */
function missingStorageRule(): ExclusionRule {
  return {
    id: "missing_storage",
    evaluate(listing: ListingDetail) {
      const text = `${listing.title} ${listing.descriptionText}`;
      if (!mentionsNoStorage(text)) return { excluded: false };
      if (extractStorageGb(text) > 0) return { excluded: false };
      return { excluded: true, reason: "missing_storage" };
    },
  };
}

/** Regla numérica aparte: batería con % explícito por debajo del umbral configurado. */
function batteryThresholdRule(config: SearchConfig): ExclusionRule {
  return {
    id: "battery_below_threshold",
    evaluate(listing: ListingDetail) {
      const text = `${listing.title} ${listing.descriptionText}`;
      const pct = extractBatteryPercent(text);
      if (pct === null) return { excluded: false };
      if (pct < config.minBatteryPercent) {
        return { excluded: true, reason: `battery_${pct}pct` };
      }
      return { excluded: false };
    },
  };
}

/**
 * Precio por encima de maxPriceUsd normalmente descarta — salvo la excepción
 * de reacondicionados: si es refurbished (conditionId en refurbishedConditionIds),
 * tiene "Best Offer" habilitado, y el precio de lista no pasa
 * refurbishedExceptionMaxPrice, se deja pasar (la idea es negociar el precio
 * final por debajo de maxPriceUsd antes de comprar).
 */
function priceEligibilityRule(config: SearchConfig): ExclusionRule {
  const refurbishedIds = new Set(config.refurbishedConditionIds.map(String));
  return {
    id: "price_over_budget",
    evaluate(listing: ListingDetail) {
      if (listing.price == null || listing.price <= config.maxPriceUsd) {
        return { excluded: false };
      }

      const isRefurbished = listing.conditionId != null && refurbishedIds.has(listing.conditionId);
      const hasBestOffer = listing.buyingOptions.includes("BEST_OFFER");
      if (isRefurbished && hasBestOffer && listing.price <= config.refurbishedExceptionMaxPrice) {
        return { excluded: false };
      }

      return { excluded: true, reason: "price_over_budget" };
    },
  };
}

export function createExclusionRules(config: SearchConfig): ExclusionRule[] {
  return [
    ...patternRules(config),
    partOrLockedRule(),
    implausiblePriceRule(config),
    missingStorageRule(),
    batteryThresholdRule(config),
    priceEligibilityRule(config),
  ];
}

/** Corre todas las reglas y devuelve la primera que descarta (o ninguna). */
export function evaluateExclusions(
  rules: ExclusionRule[],
  listing: ListingDetail,
): { qualifies: boolean; reason?: string } {
  for (const rule of rules) {
    const result = rule.evaluate(listing);
    if (result.excluded) return { qualifies: false, reason: result.reason ?? rule.id };
  }
  return { qualifies: true };
}

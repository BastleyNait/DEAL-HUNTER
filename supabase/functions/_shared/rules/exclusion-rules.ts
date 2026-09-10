import type { ExclusionRule, ListingDetail, SearchConfig } from "../domain/types.ts";
import { extractBatteryPercent } from "../domain/hardware-signals.ts";

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

export function createExclusionRules(config: SearchConfig): ExclusionRule[] {
  return [...patternRules(config), batteryThresholdRule(config)];
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

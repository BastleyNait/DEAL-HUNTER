import type { ExclusionRule, ListingDetail, SearchConfig } from "../domain/types.ts";
import {
  declaresDamage,
  declaresUnitFailure,
  declaresMissingRam,
  declaresSevereCrack,
  extractBatteryPercent,
  extractStorageGb,
  mentionsNoStorage,
} from "../domain/hardware-signals.ts";
import { createUrgentDealMatcher } from "../domain/urgent-deals.ts";
import { createHighSpecMatcher } from "../domain/high-spec-exception.ts";

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
 * Reputación del vendedor. Se evalúa en el pre-descarte (los datos vienen en el
 * resultado de búsqueda), así que filtra sin gastar llamadas de detalle.
 * Si eBay no devuelve datos del vendedor no se descarta: falta de dato no es
 * lo mismo que mala reputación.
 */
function sellerReputationRule(config: SearchConfig): ExclusionRule {
  return {
    id: "seller_below_threshold",
    evaluate(listing: ListingDetail) {
      const { sellerFeedbackScore: score, sellerFeedbackPercentage: pct } = listing;

      if (score !== null && score < config.minSellerFeedbackScore) {
        return { excluded: true, reason: `seller_only_${score}_sales` };
      }
      if (pct !== null && pct < config.minSellerFeedbackPercentage) {
        return { excluded: true, reason: `seller_feedback_${pct}pct` };
      }
      return { excluded: false };
    },
  };
}

/**
 * Reglas que miran solo el título: repuestos sueltos, equipos bloqueados y
 * defectos declarados (pantalla, teclado, golpes). Van contra el título y no
 * contra la descripción a propósito — ver el comentario de titleExcludePatterns
 * en domain/types.ts.
 */
function titlePatternRules(config: SearchConfig): ExclusionRule[] {
  return config.titleExcludePatterns.map((p) => {
    const regex = new RegExp(p.pattern, p.flags);
    return {
      id: p.reason,
      evaluate(listing: ListingDetail) {
        return { excluded: regex.test(listing.title), reason: p.reason };
      },
    };
  });
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

/** Daño estructural o funcional declarado por el vendedor, no negado. */
function declaredDamageRule(): ExclusionRule {
  return {
    id: "declared_damage",
    evaluate(listing: ListingDetail) {
      const text = `${listing.title} ${listing.descriptionText}`;
      return { excluded: declaresDamage(text), reason: "declared_damage" };
    },
  };
}

/**
 * Para repuestos o que no funciona, dicho en la descripción. Es regla de código
 * y no un patrón de config porque necesita contexto: la regex vieja descartaba
 * "No power adapter included", la política de devoluciones y un puerto USB
 * que no anda (ver declaresUnitFailure). En el título sigue siendo un patrón
 * (titleExcludePatterns), donde no hay política que confunda.
 */
function unitFailureRule(): ExclusionRule {
  return {
    id: "for_parts_or_not_working",
    evaluate(listing: ListingDetail) {
      return { excluded: declaresUnitFailure(listing.descriptionText), reason: "for_parts_or_not_working" };
    },
  };
}

/** Sin RAM: no se revende sin comprarle memoria. Título y descripción. */
function missingRamRule(): ExclusionRule {
  return {
    id: "missing_ram",
    evaluate(listing: ListingDetail) {
      return { excluded: declaresMissingRam(`${listing.title}. ${listing.descriptionText}`), reason: "missing_ram" };
    },
  };
}

/**
 * Pantalla o bisagra rajada o rota: eso no se revende. Las demás grietas
 * (bezel, carcasa) no descartan: se marcan para revisar fotos (cosmeticNote).
 */
function crackedRule(): ExclusionRule {
  return {
    id: "declared_cracked",
    evaluate(listing: ListingDetail) {
      return { excluded: declaresSevereCrack(`${listing.title}. ${listing.descriptionText}`), reason: "declared_cracked" };
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
 *
 * La otra excepción es la OFERTA URGENTE: la combinación ideal (RAM, disco,
 * CPU, sin problemas) puede llegar hasta urgentDeal.maxPriceUsd aunque pase
 * del presupuesto general. `lenientUrgent` es para el pre-descarte, que no
 * tiene la descripción completa (ver UrgentDealMatcher).
 */
function priceEligibilityRule(config: SearchConfig, lenientUrgent: boolean): ExclusionRule {
  const refurbishedIds = new Set(config.refurbishedConditionIds.map(String));
  const urgentMatcher = createUrgentDealMatcher(config);
  const highSpecMatcher = createHighSpecMatcher(config);
  const brandCaps = (config.brandPriceCaps ?? []).map((c) => ({ re: new RegExp(c.pattern, c.flags), max: c.maxPriceUsd }));
  return {
    id: "price_over_budget",
    evaluate(listing: ListingDetail) {
      if (listing.price == null || listing.price <= config.maxPriceUsd) {
        return { excluded: false };
      }

      if (urgentMatcher.isUrgent(listing, { lenient: lenientUrgent })) return { excluded: false };
      // 16GB + 1TB: vale pagar más (ver highSpecException).
      if (highSpecMatcher.isHighSpec(listing, { lenient: lenientUrgent })) return { excluded: false };
      // Marcas con tope propio (Lenovo hasta $220).
      if (brandCaps.some((c) => c.re.test(listing.title) && listing.price! <= c.max)) return { excluded: false };

      const isRefurbished = listing.conditionId != null && refurbishedIds.has(listing.conditionId);
      const hasBestOffer = listing.buyingOptions.includes("BEST_OFFER");
      if (isRefurbished && hasBestOffer && listing.price <= config.refurbishedExceptionMaxPrice) {
        return { excluded: false };
      }

      return { excluded: true, reason: "price_over_budget" };
    },
  };
}

/**
 * `lenientUrgent` en true es el juego de reglas del pre-descarte (solo título
 * y resumen); en false, el definitivo con el detalle completo.
 */
export function createExclusionRules(config: SearchConfig, lenientUrgent = false): ExclusionRule[] {
  return [
    ...patternRules(config),
    ...titlePatternRules(config),
    sellerReputationRule(config),
    declaredDamageRule(),
    unitFailureRule(),
    missingRamRule(),
    crackedRule(),
    implausiblePriceRule(config),
    missingStorageRule(),
    batteryThresholdRule(config),
    priceEligibilityRule(config, lenientUrgent),
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

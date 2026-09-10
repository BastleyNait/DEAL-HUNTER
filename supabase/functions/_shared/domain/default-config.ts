import type { SearchConfig } from "./types.ts";

/**
 * Valores por defecto. Son los que pediste al armar esto: laptops i7 10ma/11va,
 * i5 11va/12va, Ryzen 5 5000, Ryzen 7 4000, bajo $200.
 *
 * Es la ÚNICA fuente de verdad de estos defaults: la migración
 * `0003_search_config.sql` siembra la tabla `search_config` con este mismo
 * objeto, y si esa fila no existiera (o falla la lectura), el
 * SupabaseConfigProvider cae acá. Para cambiar el criterio sin tocar código,
 * editá la fila en la tabla `search_config` — no hace falta redeployar.
 */
export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  marketplaceId: "EBAY_US",
  // 177 = "PC Laptops & Netbooks" en eBay US.
  categoryId: "177",
  // El envío final es a un casillero en EE.UU. (Doral, FL), no a Perú
  // directamente, así que solo importa que el vendedor envíe dentro de EE.UU.
  deliveryCountry: "US",
  maxPriceUsd: 200,
  // Reacondicionados (2000/2500) con "Best Offer" habilitado pueden listar hasta
  // acá: la idea es ofertar y bajar el precio final a <= maxPriceUsd antes de
  // comprar. Ver rules/exclusion-rules.ts -> priceEligibilityRule.
  refurbishedExceptionMaxPrice: 225,
  refurbishedConditionIds: [2000, 2500],
  greatDealMaxPrice: 160,
  greatDealMinScore: 80,
  // Excluye 7000 = "For parts or not working".
  includedConditionIds: [1000, 1500, 2000, 2500, 3000, 4000, 5000, 6000],
  includeAuctions: true,
  maxPages: 2,
  maxCandidatesPerRun: 25,
  minBatteryPercent: 70,
  // Cada patrón cubre dos formas de anunciar la CPU: (a) el modelo explícito
  // (i7-1165G7, i7-11800H, Ryzen 5 5500U...) con separador opcional (espacio,
  // guion, ®/™, o nada) y largo de dígitos variable (Intel usa 4 dígitos en
  // los U/G-series y 5 en los H-series, para la misma generación); (b) el
  // nombre de la familia y la mención de generación en cualquier parte del
  // título, aunque el vendedor no ponga el modelo exacto ("i7 11th Gen",
  // "11th Gen i5", "Ryzen 5 5000 Series"). Ver hunt-deals/README para cómo
  // probar un patrón nuevo contra títulos reales antes de guardarlo acá.
  cpuPatterns: [
    {
      label: "Intel i7 11th gen",
      pattern: "\\bi7[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)",
      flags: "i",
      tier: 6,
    },
    {
      label: "Intel i5 12th gen",
      pattern: "\\bi5[\\s®™_-]*12\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b12[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)",
      flags: "i",
      tier: 5,
    },
    {
      label: "Intel i7 10th gen",
      pattern: "\\bi7[\\s®™_-]*10\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b10[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)",
      flags: "i",
      tier: 4,
    },
    {
      label: "AMD Ryzen 7 4000",
      pattern: "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?4\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b4000\\b)",
      flags: "i",
      tier: 3,
    },
    {
      label: "Intel i5 11th gen",
      pattern: "\\bi5[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)",
      flags: "i",
      tier: 2,
    },
    {
      label: "AMD Ryzen 5 5000",
      pattern: "\\b(?:ryzen[\\s®™_-]*5|r5)[\\s-]?5\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b5000\\b)",
      flags: "i",
      tier: 1,
    },
  ],
  excludePatterns: [
    {
      reason: "for_parts_or_not_working",
      pattern: "for\\s*parts|not\\s*working|parts\\s*only|parts[\\s\\/]*repair|no\\s*enciende|no\\s*prende|no\\s*power",
      flags: "i",
    },
    {
      reason: "missing_storage",
      pattern: "no\\s*(hard\\s*drive|hdd|ssd|storage)|missing\\s*(hard\\s*drive|hdd|ssd|storage)|without\\s*(hard\\s*drive|hdd|ssd|storage)|sin\\s*disco(\\s*duro)?|sin\\s*almacenamiento",
      flags: "i",
    },
    {
      reason: "missing_battery",
      pattern: "no\\s*battery|missing\\s*battery|battery\\s*not\\s*included|without\\s*battery|sin\\s*bateria|sin\\s*batería",
      flags: "i",
    },
    {
      reason: "battery_fair_or_worse",
      pattern: "batt(?:ery)?\\s*(health|condition)?\\s*[:\\-]?\\s*(fair|poor|bad)\\b",
      flags: "i",
    },
  ],
};

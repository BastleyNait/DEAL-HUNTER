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
  minFixedPriceUsd: 25,
  minSellerFeedbackScore: 1000,
  minSellerFeedbackPercentage: 95,
  // Reacondicionados (2000/2500) con "Best Offer" habilitado pueden listar hasta
  // acá: la idea es ofertar y bajar el precio final a <= maxPriceUsd antes de
  // comprar. Ver rules/exclusion-rules.ts -> priceEligibilityRule.
  refurbishedExceptionMaxPrice: 225,
  refurbishedConditionIds: [2000, 2010, 2020, 2030, 2500],
  greatDealMaxPrice: 160,
  greatDealMinScore: 80,
  // Todos los condition IDs de eBay MENOS 7000 ("For parts or not working").
  // Importante: 2010/2020/2030 (Excellent/Very Good/Good - Refurbished), 2750
  // (Like New) y 1750 (New with defects) faltaban y eBay estaba filtrando esos
  // listados del lado del servidor — justo el segmento de refurbished que nos
  // interesa.
  includedConditionIds: [1000, 1500, 1750, 2000, 2010, 2020, 2030, 2500, 2750, 3000, 4000, 5000, 6000],
  includeAuctions: true,
  /**
   * Pool de vetas de búsqueda. Medido contra la API real: `q=laptop` rinde solo
   * ~23 matches por cada 100 resultados, mientras que las queries por número de
   * modelo rinden ~99/100 y tienen cientos de listados bajo el tope de precio
   * (ej. "1145g7" -> ~949). Por eso el grueso del pool son modelos concretos,
   * ordenados por precio (las más baratas de cada veta = las mejores ofertas),
   * más algunas queries amplias por "recién publicado" para no perder lo nuevo.
   */
  searchProfiles: [
    // --- Recién publicados (agarrar lo nuevo antes que el resto) ---
    { query: "laptop", sort: "newlyListed", maxPages: 2 },
    { query: "notebook i7", sort: "newlyListed", maxPages: 1 },
    { query: "i7 11th gen", sort: "newlyListed", maxPages: 1 },
    { query: "i5 11th gen", sort: "newlyListed", maxPages: 1 },
    { query: "i5 12th gen", sort: "newlyListed", maxPages: 1 },
    { query: "i7 10th gen", sort: "newlyListed", maxPages: 1 },
    { query: "i7 12th gen", sort: "newlyListed", maxPages: 1 },
    { query: "ryzen 5 laptop", sort: "newlyListed", maxPages: 1 },
    { query: "ryzen 7 laptop", sort: "newlyListed", maxPages: 1 },

    // --- Intel 11va gen (modelos concretos, ordenados por precio) ---
    { query: "1135g7", sort: "price", maxPages: 1 },
    { query: "1145g7", sort: "price", maxPages: 1 },
    { query: "1155g7", sort: "price", maxPages: 1 },
    { query: "1165g7", sort: "price", maxPages: 1 },
    { query: "1185g7", sort: "price", maxPages: 1 },
    { query: "11300h", sort: "price", maxPages: 1 },
    { query: "11400h", sort: "price", maxPages: 1 },
    { query: "11800h", sort: "price", maxPages: 1 },
    { query: "11370h", sort: "price", maxPages: 1 },

    // --- Intel 12va gen ---
    { query: "1235u", sort: "price", maxPages: 1 },
    { query: "1240p", sort: "price", maxPages: 1 },
    { query: "1245u", sort: "price", maxPages: 1 },
    { query: "12500h", sort: "price", maxPages: 1 },
    { query: "1265u", sort: "price", maxPages: 1 },
    { query: "12700h", sort: "price", maxPages: 1 },

    // --- Intel 10ma gen ---
    { query: "10510u", sort: "price", maxPages: 1 },
    { query: "10610u", sort: "price", maxPages: 1 },
    { query: "10710u", sort: "price", maxPages: 1 },
    { query: "1065g7", sort: "price", maxPages: 1 },
    { query: "10750h", sort: "price", maxPages: 1 },
    { query: "10850h", sort: "price", maxPages: 1 },

    // --- AMD ---
    { query: "ryzen 5 5500u", sort: "price", maxPages: 1 },
    { query: "ryzen 5 5625u", sort: "price", maxPages: 1 },
    { query: "ryzen 5 5600h", sort: "price", maxPages: 1 },
    { query: "ryzen 7 5700u", sort: "price", maxPages: 1 },
    { query: "ryzen 7 5800h", sort: "price", maxPages: 1 },
    { query: "ryzen 7 4700u", sort: "price", maxPages: 1 },
    { query: "ryzen 7 4800h", sort: "price", maxPages: 1 },

    // --- Líneas corporativas baratas (volumen alto, precisión media) ---
    { query: "latitude i5", sort: "price", maxPages: 1 },
    { query: "elitebook i5", sort: "price", maxPages: 1 },
    { query: "thinkpad i7", sort: "price", maxPages: 1 },
    { query: "probook ryzen", sort: "price", maxPages: 1 },

    // --- Subastas por terminar (precio actual bajo) ---
    { query: "laptop i7", sort: "endingSoonest", maxPages: 1 },
    { query: "laptop i5", sort: "endingSoonest", maxPages: 1 },
  ],
  // 10 vetas por corrida: con el cron cada 15 min, el pool completo (~42) se
  // recorre cada ~1 hora sin pasarse de la cuota diaria de la Browse API.
  profilesPerRun: 10,
  maxCandidatesPerRun: 30,
  notifyOnlyGreatDeals: true,
  maxNotificationsPerRun: 8,
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
    // i7 12va y Ryzen 7 5000 no estaban en el pedido original, pero son
    // estrictamente mejores que las que sí están (i7 11va / R7 4000 / R5 5000)
    // al mismo tope de precio. Si no las querés, se sacan del array en la fila
    // de `search_config` sin redeployar.
    {
      label: "Intel i7 12th gen",
      pattern: "\\bi7[\\s®™_-]*12\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b12[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)",
      flags: "i",
      tier: 8,
    },
    {
      label: "Intel i7 11th gen",
      pattern: "\\bi7[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi7\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)",
      flags: "i",
      tier: 7,
    },
    {
      label: "AMD Ryzen 7 5000",
      pattern: "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?5\\d{3}[a-z]{0,2}\\b",
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
    // "missing_storage" ya no vive acá: pasó a ser regla de código
    // (rules/exclusion-rules.ts) porque necesita cruzar la frase con la
    // ausencia de una capacidad concreta.
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
    {
      // Daño declarado sin ambigüedad. A diferencia de las muletillas tipo
      // "may show signs of wear", estas son afirmaciones concretas del
      // vendedor, así que sí valen contra la descripción.
      reason: "declared_damage",
      pattern: "\\bdamage\\s+such\\s+as\\b|\\b(?:have|has|with)\\s+damage\\b|\\bdisplay\\s+blemish",
      flags: "i",
    },
  ],
  // Solo contra el título: el objetivo es revender rápido, así que cualquier
  // defecto declarado (pantalla, teclado, golpes) descarta el equipo.
  titleExcludePatterns: [
    {
      reason: "part_or_component",
      pattern:
        "\\b(?:motherboard|mainboard|system\\s*board|logic\\s*board|palm\\s*rest|palmrest|heat\\s*sink|heatsink|fan|cooler|hinge|bezel|ribbon|(?:lcd|screen|display|keyboard|touchpad|battery|webcam|speaker)\\s*(?:assembly|replacement|only))\\b",
      flags: "i",
    },
    {
      reason: "bios_locked",
      pattern: "\\bbios\\s*(?:is\\s*)?(?:locked|password)\\b|\\blocked\\s*to\\s*bios\\b",
      flags: "i",
    },
    {
      // Grado del equipo entero (no de la batería): D y F son daño declarado.
      // C queda afuera a propósito — esas se marcan para revisar, no se tiran.
      reason: "low_grade_unit",
      pattern: "\\b[df][\\s-]?grade\\b|\\bgrade\\s*[-:]?\\s*[df]\\b",
      flags: "i",
    },
    {
      reason: "screen_defect",
      pattern:
        "\\b(?:hot\\s*spot|hotspot|pressure\\s*(?:mark|spot)|dead\\s*pixel|stuck\\s*pixel|backlight\\s*bleed|screen\\s*(?:damage|crack|scratch|issue|burn)|cracked\\s*screen|broken\\s*screen|discolor)",
      flags: "i",
    },
    {
      reason: "keyboard_defect",
      pattern:
        "\\b(?:keyboard|key|trackpad|touchpad)\\s*(?:issue|problem|damage|not\\s*working)\\b|\\bmissing\\s*keys?\\b|\\bkeys?\\s*missing\\b|\\bsticky\\s*keys\\b",
      flags: "i",
    },
    {
      // El lookbehind evita descartar por frases positivas del estilo
      // "no cracks or dents", que son justamente lo que buscamos.
      reason: "declared_defect",
      pattern:
        "\\bcosmetic\\s*(?:issue|damage|defect|flaw)|\\bas[-\\s]is\\b|\\bwater\\s*damage\\b|(?<!\\bno\\s)(?<!\\bnot\\s)(?<!\\bsin\\s)\\b(?:cracked|broken|damaged|dented|defective|faulty)\\b",
      flags: "i",
    },
  ],
};

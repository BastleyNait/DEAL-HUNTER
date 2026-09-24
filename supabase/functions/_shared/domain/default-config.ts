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

    // --- Lo que realmente se compró: ThinkPad L-series y Dynabook Portégé,
    //     más la serie Ryzen 7000 que antes no se buscaba ---
    { query: "thinkpad l14", sort: "price", maxPages: 1 },
    { query: "thinkpad l15", sort: "price", maxPages: 1 },
    { query: "thinkpad l13", sort: "price", maxPages: 1 },
    { query: "thinkpad t14", sort: "price", maxPages: 1 },
    { query: "dynabook portege", sort: "price", maxPages: 1 },
    { query: "portege x30", sort: "price", maxPages: 1 },
    { query: "7530u", sort: "price", maxPages: 1 },
    { query: "7730u", sort: "price", maxPages: 1 },
    { query: "1245u", sort: "newlyListed", maxPages: 1 },

    // --- Subastas por terminar (precio actual bajo) ---
    { query: "laptop i7", sort: "endingSoonest", maxPages: 1 },
    { query: "laptop i5", sort: "endingSoonest", maxPages: 1 },
  ],
  // 10 vetas por corrida: con el cron cada 15 min, el pool completo (~42) se
  // recorre cada ~1 hora sin pasarse de la cuota diaria de la Browse API.
  profilesPerRun: 10,
  maxCandidatesPerRun: 30,
  // Solo avisa lo que supera este puntaje, sea compra directa o subasta.
  notifyScoreAbove: 70,
  maxNotificationsPerRun: 8,
  auctionAlertMaxMinutesLeft: 20,
  auctionAlertMaxPrice: 150,
  // Regency pone subastas con pujas bajas que casi siempre terminan por encima
  // de $200: eran 24 de los 27 avisos de subasta del primer día con la
  // ventana de 20 minutos, y ninguno servía.
  auctionAlertExcludedSellers: ["regencytechnologies"],
  maxAuctionAlertsPerRun: 6,
  refreshCallsPerRun: 20,
  refreshStaleMinutes: 120,
  refreshAlertWindowMinutes: 40,
  // (costo + $40 de flete al casillero) × 1.60 de margen.
  publishMarkupFlatUsd: 40,
  publishMarkupMultiplier: 1.6,
  // Mismo valor por defecto que NEXT_PUBLIC_USD_RATE en REVOLT-LAP.
  publishUsdToPenRate: 3.7,
  minBatteryPercent: 70,
  // Las que más te interesan: encabezan el dashboard y van primero en los
  // avisos, siempre que superen notifyScoreAbove.
  priorityCpus: ["Intel i5 12th gen", "Intel i7 11th gen"],
  /**
   * Ofertas especiales: la serie Portégé de Dynabook (ex-Toshiba). Poco
   * conocida en Perú, pero de lo mejor que se probó en su rango de precio —
   * dos de las compras reales fueron una X30W-J ($153.78) y una X30L-J
   * ($165). X30L/X30W (13"), X40 (14") y X50 (15,6") son la misma línea de
   * gama alta ultraliviana; J = Intel 11.ª gen, K = 12.ª gen.
   *
   * El patrón exige Dynabook/Portégé/Toshiba en el título para que un "X40"
   * suelto de otra marca no entre por casualidad.
   */
  specialDeals: [
    {
      label: "Dynabook Portégé serie J",
      pattern: "^(?=.*(?:dynabook|port[eé]g[eé]|toshiba)).*\\bx(?:30[lw]|40|50)[\\s-]?j\\b",
      flags: "i",
      impliedIntelGeneration: 11,
    },
    {
      label: "Dynabook Portégé serie K",
      pattern: "^(?=.*(?:dynabook|port[eé]g[eé]|toshiba)).*\\bx(?:30[lw]|40|50)[\\s-]?k\\b",
      flags: "i",
      impliedIntelGeneration: 12,
    },
  ],
  // Medido contra la API real: "dynabook" trae ~70 publicaciones bajo $225 en
  // todo eBay US (entran en una sola página) y cubre todas las Portégé J;
  // "portege" suma las que se publican como Toshiba sin decir Dynabook. Dos
  // llamadas por corrida, ~190 por día, sobre una cuota de 5.000.
  specialSearchProfiles: [
    { query: "dynabook", sort: "newlyListed", maxPages: 1 },
    { query: "portege", sort: "newlyListed", maxPages: 1 },
  ],
  /**
   * Escalafón de reventa. Gana el primer patrón que matchea el título, así que
   * el orden importa: van de mejor a peor.
   *
   * El criterio combina las compras reales (4 ThinkPad, 2 Dynabook Portégé) con
   * lo que se sostiene del mercado de segunda mano: las ThinkPad T/X tienen
   * chasis de magnesio o fibra de vidrio y son de las más duraderas, con
   * repuestos fáciles; las EliteBook son de las corporativas que mejor
   * envejecen; las Latitude son confiables pero no tienen ventaja de
   * durabilidad, y en la práctica llegan con la tapa muy rayada, que es lo que
   * frena la reventa. Las líneas de consumo (Inspiron, Pavilion, IdeaPad,
   * Aspire) caen al valor de respaldo.
   */
  modelTiers: [
    { label: "ThinkPad T / X / P", pattern: "thinkpad\\s*[txp]\\d|thinkpad\\s*x1", flags: "i", weight: 1 },
    { label: "ThinkPad (cualquier línea)", pattern: "thinkpad|think\\s*pad", flags: "i", weight: 0.95 },
    { label: "HP EliteBook / ZBook", pattern: "elitebook|zbook", flags: "i", weight: 0.85 },
    { label: "Dynabook Portégé / Tecra", pattern: "port[ée]g[ée]|portege|dynabook|tecra", flags: "i", weight: 0.8 },
    { label: "HP ProBook", pattern: "probook", flags: "i", weight: 0.68 },
    { label: "Dell Precision / Surface Laptop", pattern: "precision|surface\\s*laptop", flags: "i", weight: 0.55 },
    { label: "Dell Latitude", pattern: "latitude", flags: "i", weight: 0.5 },
  ],
  modelFallbackWeight: 0.25,
  /**
   * Restas fijas al puntaje. La Latitude ya pesa menos en el factor de modelo,
   * pero eso solo no alcanzaba para sacarla de los avisos: llegan con la tapa
   * rayada y cuestan en la reventa.
   *
   * "Damage" se busca también en la descripción, pero ignorando dos cosas que
   * en los datos reales eran la mitad de las menciones: la negación ("no
   * missing or damaged parts", "damage free screen") y el texto de políticas
   * ("unless the item arrived damaged", "transit damage", las leyendas de
   * grados de los refurbishers). Lo que queda es el daño declarado del equipo:
   * "paint damage on lid", "left-side hinge damaged".
   */
  scorePenalties: [
    { label: "Dell Latitude", pattern: "latitude", flags: "i", points: 10, scope: "title", ignoreNegated: false },
    {
      label: "Declara daño",
      pattern: "\\b(?:dmg|damaged?)\\b",
      flags: "i",
      points: 10,
      scope: "titleAndDescription",
      ignoreNegated: true,
      ignoreContextPattern:
        "ship|transit|package|parcel|carrier|\\bups\\b|fedex|usps|deliver|return|refund|claim|tamper|arriv|not as (?:described|shown)|warranty|misuse|abuse|accident|avoid|any signs of|materials recovery|sanitized|latches, hinges|used (?:excellent|fair|poor)|new open box",
    },
  ],
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
      // Mismo tier que la i7 11va: es la CPU de 3 de las 6 compras reales.
      label: "Intel i5 12th gen",
      pattern: "\\bi5[\\s®™_-]*12\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b12[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)",
      flags: "i",
      tier: 7,
    },
    {
      // Serie 7000: faltaba por completo, y una de las compras reales fue un
      // Ryzen 5 7530U que el sistema ni siquiera reconocía.
      label: "AMD Ryzen 7 7000",
      pattern: "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?7\\d{3}[a-z]{0,2}\\b",
      flags: "i",
      tier: 7,
    },
    {
      label: "AMD Ryzen 5 7000",
      pattern: "\\b(?:ryzen[\\s®™_-]*5|r5)[\\s-]?7\\d{3}[a-z]{0,2}\\b",
      flags: "i",
      tier: 6,
    },
    {
      label: "AMD Ryzen 7 5000",
      pattern: "\\b(?:ryzen[\\s®™_-]*7|r7)[\\s-]?5\\d{3}[a-z]{0,2}\\b",
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
      label: "Intel i5 11th gen",
      pattern: "\\bi5[\\s®™_-]*11\\d{2,3}[a-z0-9]{0,3}\\b|(?=.*\\bi5\\b)(?=.*\\b11[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)",
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
    // "declared_damage" no vive acá: pasó a ser regla de código
    // (rules/exclusion-rules.ts) porque necesita cruzar la frase de daño con
    // que no venga negada ("No Water Damage", "won't be any damage").
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

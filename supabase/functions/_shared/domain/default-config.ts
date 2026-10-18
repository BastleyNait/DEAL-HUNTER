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
  // Igual que el tope de OFERTA URGENTE: nada por encima de $220 (ni en la
  // lista, ni en los avisos, ni en el dashboard).
  refurbishedExceptionMaxPrice: 220,
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
   * Tipo de oferta "2 en 1": laptops convertibles (la pantalla gira 360° o se
   * separa y funcionan como tablet) que además cumplen todo lo demás — precio,
   * CPU, vendedor, sin defectos declarados. Antes este tipo era la serie
   * Portégé de Dynabook; pasó a ser el formato de la máquina, no el modelo.
   *
   * Se reconoce por el título. Los datos estructurados de eBay no sirven acá:
   * "Form Factor" casi nunca viene, y cuando viene dice "Laptop".
   *
   * Cuidados del patrón, medidos contra ~19 títulos dudosos reales:
   *  - "Yoga Slim" y "Yoga Pro" NO son 2 en 1 (son clamshell de la línea
   *    Yoga), por eso el lookahead. "Yoga" a secas, "Yoga 7i", "Yoga 9" sí.
   *  - Un táctil a secas ("Touchscreen") tampoco alcanza: hay muchas laptops
   *    táctiles con bisagra normal.
   *  - IdeaPad/Galaxy Book "Flex", ZenBook "Flip", "Spin" de Acer y Dell
   *    "2n1" son convertibles aunque no digan "2 en 1".
   *
   * Modelos que son 2 en 1 aunque el vendedor no lo diga (buscados en la web y
   * medidos contra ~9.000 publicaciones guardadas; los demás ya dicen "x360",
   * "Yoga", "Flex" o "2-in-1" en el nombre, así que ya entraban):
   *  - HP Elite Dragonfly (G1-G3 y Max): 23 publicaciones se escapaban.
   *  - "Detachable" (Latitude 7320 Detachable, ThinkPad X12 Detachable).
   *  - Surface Book y Laptop Studio. Surface Pro NO: es una tablet, y muchas
   *    se venden sin teclado.
   *  - Códigos de Asus Flip (UX360/370/461/462/463/561/562/563, TP4xx/TM420),
   *    Lenovo IdeaPad C340, Dell XPS 13 9365, Fujitsu Lifebook U9xx,
   *    Dynabook X20W.
   *  - Se excluyen Chromebook (el Dragonfly Chromebook es ChromeOS) y las
   *    tablets "tablet only" o "no keyboard".
   *
   * Lo que NO se puede resolver por título: Latitude 5310/5320/7320/7410/
   * 7420/9420 y similares existen en las dos versiones, y de 1.127 títulos
   * medidos solo 1 decía 2 en 1 en la descripción. Sin la palabra no se
   * distinguen de la versión normal (la mayoría), así que no se marcan.
   *
   * La Portégé X30W-J/K va aparte porque es la única que entra por modelo: la
   * W es la variante convertible, y sus títulos ("X30W-J ... i5 2.49GHz")
   * casi nunca dicen "2-in-1" ni traen el modelo de CPU, así que se deduce la
   * generación de la serie (J = 11.ª, K = 12.ª). Va primero: el primer patrón
   * que matchea manda, y solo este trae impliedIntelGeneration.
   */
  specialDeals: [
    {
      label: "2 en 1",
      pattern: "^(?=.*(?:dynabook|port[eé]g[eé]|toshiba)).*\\bx30w[\\s-]?j\\b",
      flags: "i",
      impliedIntelGeneration: 11,
    },
    {
      label: "2 en 1",
      pattern: "^(?=.*(?:dynabook|port[eé]g[eé]|toshiba)).*\\bx30w[\\s-]?k\\b",
      flags: "i",
      impliedIntelGeneration: 12,
    },
    {
      label: "2 en 1",
      pattern:
        "\\b(?:2[\\s-]?in[\\s-]?1|2n1|two[\\s-]?in[\\s-]?one|convertible|x360|flip|spin\\s?\\d{1,2}|flex\\s?\\d{1,2}|detachable|dragonfly|surface\\s?book|laptop\\s?studio|c340|xps\\s?13\\s?9365|x20w)\\b|\\byoga(?!\\s?(?:slim|pro))|360\\s?(?:°|º|deg)|\\bux(?:360|370|461|462|463|561|562|563)\\w*|\\bt[pm]4\\d{2}\\w*|\\blifebook\\s?u9\\w*",
      flags: "i",
      impliedIntelGeneration: null,
      excludePattern: "chrome\\s?(?:os|book)|tablet\\s?only|no\\s?keyboard",
      // Las Dell 2 en 1 (Latitude, Inspiron, XPS) siguen marcadas pero con
      // prioridad baja: llegan seguido rayadas o rotas, igual que la Latitude
      // ya pesa menos en el escalafón y resta 10 puntos. La misma decisión.
      demotePattern: "\\b(?:dell|latitude|inspiron|xps)\\b",
    },
  ],
  /**
   * OFERTA URGENTE: 16GB de RAM o más, disco SSD de 512GB o más, una de las
   * CPUs que más importan y hasta $220 en compra directa. Es el aviso que
   * le gana a todos los demás en el mensaje de Telegram, y se manda aunque el
   * puntaje no llegue al umbral.
   *
   * CPUs: las dos prioritarias (i5 12.ª e i7 11.ª) y sus equivalentes Ryzen,
   * que son los de rendimiento parecido: Ryzen 7 5000 (5700U, 5800H) ~ i7
   * 11.ª; Ryzen 5 7000 (7530U) y Ryzen 7 7000 (7730U) ~ i5 12.ª. Ryzen 5 5000
   * y Ryzen 7 4000 quedan afuera: son un escalón más abajo.
   *
   * El tope ($220, inclusive) es mayor que maxPriceUsd ($200): solo las que cumplen todo
   * lo demás pueden pasar de $200. El resto de las reglas (batería, daño,
   * partes, vendedor) siguen valiendo igual.
   *
   * El filtro de problemas es más estricto que el descarte general: lo que
   * ahí es un defecto declarado, acá también lo es cualquier mención de
   * "issues", "problems", batería ausente o mala, "not working", etc. dicha
   * sobre el equipo. Una negación ("no issues") o una oración sobre la política
   * de la tienda ("contact us if you have any issues") no cuentan.
   */
  urgentDeal: {
    label: "OFERTA URGENTE",
    maxPriceUsd: 220,
    minRamGb: 16,
    minStorageGb: 512,
    cpuLabels: ["Intel i5 12th gen", "Intel i7 11th gen", "AMD Ryzen 7 5000", "AMD Ryzen 5 7000", "AMD Ryzen 7 7000"],
    issuePattern:
      "\\b(?:issues?|problems?|defects?|defective|faulty|malfunction\\w*|broken|cracks?|cracked|swollen|(?:not|isn'?t|doesn'?t|don'?t|won'?t|can'?t|cannot)\\s+(?:be\\s+)?(?:working|charging|holding|booting|powering|turning|work|charge|hold|boot|power|turn)|(?:does|will)\\s+not\\s+(?:work|charge|hold|boot|power|turn)|needs?\\s+(?:a\\s+|new\\s+)?(?:battery|repair|replacement|charger)|(?:no|missing|without|bad|dead|weak|worn)\\s+battery(?!\\s+(?:issues?|problems?|wear|degradation|drain))|battery\\s+(?:is\\s+)?(?:missing|dead|bad|weak|worn|issues?|not))\\b",
    issueFlags: "i",
    issueIgnoreContextPattern:
      "contact|messag|reach\\s+out|let\\s+us\\s+know|tell\\s+us|notify|return|refund|warrant|guarant|polic|if\\s+(?:you|there|any|for)|should\\s+(?:you|there|any)|in\\s+case|resolv|solv|satisf|feedback|open\\s+a\\s+case|before\\s+(?:leaving|opening|bidding)|prior\\s+to|we\\s+(?:will|'ll|are\\s+happy|stand)|ship|transit|courier|carrier|please",
  },
  /**
   * Hasta $250 si tiene 16GB de RAM o más Y 1TB de SSD o más. Solo eso: la CPU
   * la exige la búsqueda (cualquiera de cpuPatterns) y el resto de las reglas
   * sigue igual. Un 1TB en HDD no cuenta.
   */
  highSpecException: {
    maxPriceUsd: 250,
    minRamGb: 16,
    minStorageGb: 1000,
  },
  /**
   * Se escapaban publicaciones buenas. Auditado contra eBay en vivo (468
   * publicaciones de 48 h con las CPUs buscadas): 48 tenían una CPU que el
   * sistema reconoce y nunca se encontraron. Las vetas por modelo ("1135g7")
   * ordenan por precio y solo miran las 100 más baratas, que eran de $10 a
   * $119 (repuestos); y las de "recién publicado" son genéricas ("i5 11th
   * gen") y no traen los títulos que solo dicen "i5-1145G7".
   *
   * Estas cinco agrupan los números de modelo (eBay acepta OR entre
   * paréntesis) y ordenan por recién publicado. Las 100 más nuevas de cada una
   * cubren entre 8 y 130 horas de publicaciones, así que corriendo cada 15
   * minutos ninguna nueva se escapa. 5 llamadas por corrida, ~480 por día.
   */
  newListingProfiles: [
    { query: "(1135g7, 1145g7, 1155g7, 1165g7, 1185g7, 1195g7)", sort: "newlyListed", maxPages: 1 },
    { query: "(11300h, 11320h, 11370h, 11375h, 11390h, 11400h, 11800h, 11850h)", sort: "newlyListed", maxPages: 1 },
    { query: "(1235u, 1245u, 1255u, 1265u, 1240p, 1250p, 1260p, 1270p, 12450h, 12500h, 12700h)", sort: "newlyListed", maxPages: 1 },
    { query: "(10510u, 10610u, 10710u, 10810u, 1065g7, 10750h, 10850h, 10875h)", sort: "newlyListed", maxPages: 1 },
    {
      query:
        "(5500u, 5600u, 5625u, 5650u, 5675u, 5700u, 5800u, 5825u, 5850u, 5600h, 5800h, 7530u, 7535u, 7730u, 7735u, 4700u, 4750u, 4800h, 4800u)",
      sort: "newlyListed",
      maxPages: 1,
    },
  ],
  // Elegidas por cobertura contra la API real (16 búsquedas candidatas, 107
  // 2 en 1 distintos con CPU reconocible bajo $225): x360 sola cubre el 32 %,
  // y con 2n1, yoga y 2-in-1 se llega a ~75 %; cada búsqueda extra suma menos.
  // Ordenadas por publicación reciente, que es lo que importa cada 15
  // minutos: una nueva cae entre las 100 primeras de su búsqueda. Cuatro
  // llamadas por corrida, ~384 por día, sobre una cuota de 5.000.
  //
  // La quinta junta los modelos de poco volumen que no dicen "2 en 1": eBay
  // acepta varios términos entre paréntesis (OR), así que son ~10 modelos en
  // UNA llamada. Da 273 resultados (más de una página), pero ordenada por
  // reciente una publicación nueva siempre cae entre las 100 primeras. Surface
  // Book va como "surface book 3" porque "surface book" a secas trae 483
  // resultados, casi todo repuestos, y taparía al resto. +96 llamadas por día.
  specialSearchProfiles: [
    { query: "x360", sort: "newlyListed", maxPages: 1 },
    { query: "2n1", sort: "newlyListed", maxPages: 1 },
    { query: "yoga", sort: "newlyListed", maxPages: 1 },
    { query: "2-in-1", sort: "newlyListed", maxPages: 1 },
    {
      query: '(dragonfly, detachable, "laptop studio", "zenbook flip", "vivobook flip", c340, "lifebook u9", "xps 9365", x20w, "surface book 3")',
      sort: "newlyListed",
      maxPages: 1,
    },
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
      // Un componente que no funciona ("One USB C Port not working", "Trackpad
      // not working"): antes descartaba la laptop entera como "para
      // repuestos"; ahora resta puntos y la decisión es tuya. Misma lista de
      // componentes y mismo filtro de política que declaresUnitFailure.
      label: "Componente con falla",
      pattern:
        "\\b(?:ports?|usb(?:[\\s-]?[ac])?|webcam|camera|cam|speakers?|audio|sound|mic(?:rophone)?|bluetooth|wi-?fi|wireless|fingerprint|reader|touch\\s*screen|touchscreen|touch|trackpad|touchpad|mouse|clicks?|keys?|keyboard|backlight|stylus|pen|buttons?|jack|hdmi|ethernet|lan|sd|card|fan|led|lights?|sensor|nfc|sim|lte|wwan|display\\s*port|screws?|covers?|feet|foot|rubber|latch)\\b(?:[^.!?\\n|•]|\\.(?=\\d)){0,40}?\\b(?:not\\s*working|(?:does\\s*not|doesn'?t|won'?t)\\s*work|non[\\s-]?functional|inoperable)\\b",
      flags: "i",
      points: 10,
      scope: "titleAndDescription",
      ignoreNegated: true,
      ignoreContextPattern:
        "return|refund|warrant|guarant|polic|listed\\s+as|label|exclud|exception|unless|\\bif\\b|\\bmay\\b|\\bshould\\b|buyer|grade[sd]?\\b|definition|not\\s+tested|untested|focus\\s+materials|\\bwe\\s+(?:will|do|are|can)|contact|as\\s+described",
    },
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
    // Los Ryzen aceptan "PRO" entre la familia y el modelo ("Ryzen 7 PRO
    // 5850U"): así se venden casi todas las ThinkPad y EliteBook con Ryzen, y
    // sin eso no se reconocían.
    //
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
      pattern: "\\b(?:ryzen[\\s®™_-]*7(?:[\\s-]*pro)?|r7)[\\s-]?7\\d{3}[a-z]{0,2}\\b",
      flags: "i",
      tier: 7,
    },
    {
      label: "AMD Ryzen 5 7000",
      pattern: "\\b(?:ryzen[\\s®™_-]*5(?:[\\s-]*pro)?|r5)[\\s-]?7\\d{3}[a-z]{0,2}\\b",
      flags: "i",
      tier: 6,
    },
    {
      label: "AMD Ryzen 7 5000",
      pattern: "\\b(?:ryzen[\\s®™_-]*7(?:[\\s-]*pro)?|r7)[\\s-]?5\\d{3}[a-z]{0,2}\\b",
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
      pattern: "\\b(?:ryzen[\\s®™_-]*7(?:[\\s-]*pro)?|r7)[\\s-]?4\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b4000\\b)",
      flags: "i",
      tier: 3,
    },
    {
      label: "AMD Ryzen 5 5000",
      pattern: "\\b(?:ryzen[\\s®™_-]*5(?:[\\s-]*pro)?|r5)[\\s-]?5\\d{3}[a-z]{0,2}\\b|(?=.*\\bryzen\\b)(?=.*\\b5000\\b)",
      flags: "i",
      tier: 1,
    },
  ],
  excludePatterns: [
    // "for_parts_or_not_working" ya no vive acá: en la descripción pasó a ser
    // regla de código (declaresUnitFailure) porque descartaba "No power
    // adapter included", la política de devoluciones y un puerto que no anda.
    // En el título sigue en titleExcludePatterns.
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
      // En el título, cualquier mención descarta: ahí no hay política de
      // devoluciones que confunda. Salvo "No Power Adapter/Cord", que es que
      // viene sin cargador.
      reason: "for_parts_or_not_working",
      pattern:
        "for\\s*parts|not\\s*working|parts\\s*only|parts[\\s\\/]*repair|no\\s*enciende|no\\s*prende|no\\s*power(?!\\s*(?:(?:adapter|cord|supply|supplies|cable|charger|brick|pack|plug)s?\\b|ac\\b|included))",
      flags: "i",
    },
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
      // "Cracked", "dented" y "cosmetic damage" ya no están: una grieta chica,
      // un golpe o un detalle estético se aceptan y se marcan para revisar las
      // fotos (findCosmeticNote). La pantalla rajada la sigue descartando
      // screen_defect, y la bisagra declared_cracked.
      reason: "declared_defect",
      pattern:
        "\\bas[-\\s]is\\b|\\bwater\\s*damage\\b|(?<!\\bno\\s)(?<!\\bnot\\s)(?<!\\bsin\\s)\\b(?:broken|damaged|defective|faulty)\\b",
      flags: "i",
    },
  ],
};

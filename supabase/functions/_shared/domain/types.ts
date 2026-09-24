// Contratos (puertos) del dominio. Nada acá sabe de eBay, Supabase ni Telegram —
// eso vive en infrastructure/*, que implementa estas interfaces.
// Esto es lo que permite, por ejemplo, cambiar eBay por otro marketplace o
// Telegram por otro canal sin tocar la lógica de negocio (hunt-service.ts).

export interface ListingSummary {
  id: string;
  title: string;
  price: number | null;
  currency: string;
  url: string;
  imageUrl: string | null;
  condition: string | null;
  conditionId: string | null;
  buyingOptions: string[];
  // Viene gratis en la búsqueda con fieldgroups=EXTENDED. Sirve para matchear
  // CPU y pre-descartar basura antes de gastar una llamada de detalle.
  shortDescription: string;
  /** Cierre de la subasta (ISO). Null en publicaciones a precio fijo. */
  endDate: string | null;
  sellerUsername: string | null;
  /** Cantidad de ventas del vendedor (feedback score de eBay). */
  sellerFeedbackScore: number | null;
  /** % de feedback positivo del vendedor. */
  sellerFeedbackPercentage: number | null;
  /** Cantidad de pujas. Null en publicaciones a precio fijo. */
  bidCount: number | null;
}

/**
 * Estado actual de una publicación ya conocida: si se puede comprar y a qué
 * precio. En una subasta, `price` es la puja actual.
 */
export interface ListingStatus {
  id: string;
  /** false si se vendió, terminó o eBay ya no la encuentra. */
  available: boolean;
  price: number | null;
  bidCount: number | null;
  endDate: string | null;
}

export interface ListingAspect {
  name: string;
  value: string;
}

export interface ListingDetail extends ListingSummary {
  /** Descripción + shortDescription + item specifics, todo junto: es lo que
   *  evalúan las reglas y el scoring. */
  descriptionText: string;
  /** Descripción del vendedor en texto plano, para las reglas y las banderas. */
  sellerDescription: string;
  /** La misma descripción con su formato, ya saneada, para mostrarla. */
  sellerDescriptionHtml: string;
  /** Item specifics (Processor, RAM, Screen Size...) como pares nombre/valor. */
  aspects: ListingAspect[];
  /** Resto de las fotos de la publicación, además de imageUrl. */
  additionalImages: string[];
}

export interface SearchPage {
  page: number;
  pageSize: number;
}

/**
 * Una "veta" de búsqueda: qué palabras clave usar y cómo ordenar. El pool vive
 * en la config (DB) y cada corrida usa solo una ventana rotativa de él, así se
 * cubren muchas más variantes sin reventar la cuota diaria de la API.
 *
 * - `sort: "price"` mina las más baratas de esa veta (las mejores ofertas).
 * - `sort: "newlyListed"` agarra lo recién publicado antes que el resto.
 * - `sort: "endingSoonest"` sirve para subastas por terminar.
 */
export interface SearchProfile {
  query: string;
  sort: "newlyListed" | "price" | "endingSoonest";
  maxPages: number;
  /** Override opcional; si no viene, usa config.categoryId. */
  categoryId?: string | null;
}

/** Puerto: cualquier marketplace de segunda mano (eBay hoy, otro mañana). */
export interface MarketplaceClient {
  search(config: SearchConfig, profile: SearchProfile, page: SearchPage): Promise<ListingSummary[]>;
  getDetail(id: string): Promise<ListingDetail>;
  /** Consulta liviana de disponibilidad y precio, para refrescar lo guardado. */
  getStatus(id: string): Promise<ListingStatus>;
}

export interface CpuMatch {
  label: string;
  tier: number;
}

/** Puerto: reconoce si un título corresponde a alguna de las CPUs buscadas. */
export interface CpuMatcher {
  match(title: string): CpuMatch | null;
}

export interface ExclusionResult {
  excluded: boolean;
  reason?: string;
}

/** Una regla de descarte independiente (for-parts, sin batería, batería baja, etc). */
export interface ExclusionRule {
  id: string;
  evaluate(listing: ListingDetail): ExclusionResult;
}

/** Un factor individual del puntaje (precio, CPU, batería, RAM, storage...). Devuelve 0..1. */
export interface ScoreFactor {
  id: string;
  weight: number;
  score(listing: ListingDetail, ctx: ScoringContext): number;
}

export interface ScoringContext {
  maxPriceUsd: number;
  cpuTier: number;
  maxCpuTier: number;
}

export interface ScoringResult {
  score: number;
  isGreatDeal: boolean;
}

/** Puerto: combina los ScoreFactor en un puntaje final + flag de "ofertaza". */
export interface ScoringStrategy {
  score(listing: ListingDetail, ctx: ScoringContext): ScoringResult;
}

export interface EvaluatedDeal {
  itemId: string;
  title: string;
  price: number | null;
  currency: string;
  condition: string | null;
  cpuMatch: string;
  url: string;
  imageUrl: string | null;
  qualified: boolean;
  rejectReason?: string;
  score: number | null;
  isGreatDeal: boolean;
  /** CPU de las que pediste ver primero (config.priorityCpus). */
  isPriority: boolean;
  /** Etiqueta del modelo especial que matcheó, o null si no es oferta especial. */
  specialLabel: string | null;
  // No descartan nada (una laptop sin datos no es "mala"), pero se guardan para
  // marcarlas en el dashboard como "revisar a mano" — el vendedor puede tener
  // buena batería/specs y simplemente no lo puso en el texto.
  hasDescription: boolean;
  hasBatteryInfo: boolean;
  // Batería calificada por letra (ej. "Battery Grade C") — no sabemos la escala
  // de cada vendedor, así que tampoco descarta: se guarda para revisar a mano.
  batteryGrade: string | null;
  // true si es subasta: el precio guardado es el actual/mínimo, no el final.
  isAuction: boolean;
  /** Acepta "Best Offer": el precio de lista es negociable. */
  hasBestOffer: boolean;
  /** Cierre de la subasta (ISO), para poder priorizar las que están por terminar. */
  endDate: string | null;
  bidCount: number | null;
  sellerUsername: string | null;
  sellerFeedbackScore: number | null;
  sellerFeedbackPercentage: number | null;
  /** Título normalizado + precio: detecta republicaciones del mismo equipo. */
  fingerprint: string;
  // Para la vista de detalle del dashboard.
  sellerDescription: string;
  sellerDescriptionHtml: string;
  aspects: ListingAspect[];
  additionalImages: string[];
}

/** Puerto: persistencia de ofertas ya evaluadas (hoy Supabase, mañana lo que sea). */
export interface DealRepository {
  filterUnseen(itemIds: string[]): Promise<string[]>;
  /** De las huellas dadas, cuáles ya existen como oferta calificada. */
  findKnownFingerprints(fingerprints: string[]): Promise<Set<string>>;
  save(deal: EvaluatedDeal): Promise<void>;
  /**
   * Subastas ya guardadas que recién ahora entran en su último tramo y todavía
   * no se avisaron. Sin esto una subasta encontrada con días de anticipación
   * nunca se avisaría: cada publicación se evalúa una sola vez.
   */
  findAuctionsToAlert(options: {
    maxPrice: number;
    maxMinutesLeft: number;
    scoreAbove: number;
    excludedSellers: string[];
    limit: number;
  }): Promise<EvaluatedDeal[]>;
  markAuctionsAlerted(itemIds: string[]): Promise<void>;
  /**
   * De los ítems dados, cuáles todavía no se avisaron, con su clave de
   * máquina. Un ítem se suprime cuando otra publicación del mismo equipo ya
   * se mandó a Telegram o ya la marcaste como vista en el dashboard: el
   * mismo vendedor republicando a otro precio genera un item_id nuevo, y sin
   * esto eso alcanzaba para que sonara el teléfono otra vez.
   */
  findNotifiableKeys(itemIds: string[]): Promise<Map<string, string>>;
  /** Marca lo que efectivamente salió a Telegram. */
  markNotified(itemIds: string[]): Promise<void>;
  /** Qué publicaciones refrescar con el presupuesto de llamadas de la corrida. */
  findListingsToRefresh(options: {
    limit: number;
    staleMinutes: number;
    alertWindowMinutes: number;
    alertMaxPrice: number;
    scoreAbove: number;
    excludedSellers: string[];
  }): Promise<string[]>;
  /** Guarda disponibilidad y precio actuales. Devuelve cuántas filas tocó. */
  applyStatuses(statuses: ListingStatus[]): Promise<number>;
}

/** Puerto: un canal de notificación (Telegram hoy; push/WhatsApp mañana). */
export interface NotificationChannel {
  notify(deal: EvaluatedDeal): Promise<void>;
  /**
   * Resumen de las ofertas que no se avisan una por una. Recibe las ofertas,
   * no texto ya armado: cómo se ven es decisión del canal, no de la aplicación.
   */
  notifyDigest(deals: EvaluatedDeal[]): Promise<void>;
}

export interface RunStats {
  itemsScanned: number;
  candidatesChecked: number;
  itemsQualified: number;
  /** Republicaciones del mismo equipo que se colapsaron en esta corrida. */
  duplicatesSkipped: number;
  error?: string;
}

/** Puerto: registro de cada corrida (para poder auditar/debuguear el cron). */
export interface RunTracker {
  start(): Promise<number | string>;
  finish(runId: number | string, stats: RunStats): Promise<void>;
}

export interface CpuPatternConfig {
  label: string;
  pattern: string;
  flags: string;
  tier: number;
}

/**
 * Modelo "oferta especial": poco conocido, pero de lo mejor en su rango de
 * precio según lo que ya se compró y se probó. Se avisa aunque no llegue al
 * umbral de puntaje, y tiene vetas de búsqueda propias que corren siempre.
 */
export interface SpecialDealConfig {
  /** Se muestra en el aviso y en el dashboard. */
  label: string;
  pattern: string;
  flags: string;
  /**
   * Generación Intel que implica el modelo (Portégé serie J = 11.ª). Solo se
   * usa cuando el título no trae un modelo de CPU reconocible ("i5 2.49GHz"):
   * sin esto, esas publicaciones se descartaban antes de evaluarse. Null si
   * el modelo no implica una generación.
   */
  impliedIntelGeneration: number | null;
}

export interface ExcludePatternConfig {
  reason: string;
  pattern: string;
  flags: string;
}

export interface ModelTierConfig {
  /** Para leer la config; no se usa en el matching. */
  label: string;
  pattern: string;
  flags: string;
  /** 0..1 — cuánto aporta al factor de modelo. */
  weight: number;
}

/**
 * Puntos que se restan al puntaje final cuando el listing menciona algo que
 * frena la reventa. No descarta: la oferta sigue en el dashboard, solo baja.
 */
export interface ScorePenaltyConfig {
  label: string;
  pattern: string;
  flags: string;
  points: number;
  /** Dónde buscar: solo el título, o título más descripción. */
  scope: "title" | "titleAndDescription";
  /** No penalizar "no damage", "without damage", "damage free". */
  ignoreNegated: boolean;
  /**
   * Si la oración donde aparece matchea esto, no cuenta. Sirve para sacar el
   * texto de políticas ("unless the item arrived damaged") que no habla del
   * equipo sino del envío o las devoluciones.
   */
  ignoreContextPattern?: string;
}

/**
 * Todo lo que define "qué es una oferta interesante". Tiene un valor por defecto
 * (default-config.ts) pero se puede sobreescribir por fila en la tabla `search_config`
 * sin redeployar la función — así queda escalable a más perfiles de búsqueda a futuro.
 */
export interface SearchConfig {
  marketplaceId: string;
  categoryId: string;
  deliveryCountry: string;
  maxPriceUsd: number;
  /**
   * Piso de precio para publicaciones a precio fijo: por debajo de esto, con
   * estas CPUs, no es un equipo completo sino un repuesto o una estafa. No
   * aplica a subastas, donde arrancar en $1 es normal.
   */
  minFixedPriceUsd: number;
  /**
   * Reputación mínima del vendedor. Un vendedor con pocas ventas o feedback
   * bajo es riesgo de estafa o de equipo que no llega como se describió.
   */
  minSellerFeedbackScore: number;
  minSellerFeedbackPercentage: number;
  // Excepción para reacondicionados con "Best Offer": el precio de lista puede
  // llegar hasta acá, porque la intención es negociar por debajo de maxPriceUsd
  // antes de comprar (ver rules/exclusion-rules.ts -> priceEligibilityRule).
  refurbishedExceptionMaxPrice: number;
  refurbishedConditionIds: number[];
  greatDealMaxPrice: number;
  greatDealMinScore: number;
  includedConditionIds: number[];
  includeAuctions: boolean;
  /** Pool completo de vetas de búsqueda (editable en DB sin redeployar). */
  searchProfiles: SearchProfile[];
  /** Cuántas vetas del pool usa cada corrida (ventana rotativa por runId). */
  profilesPerRun: number;
  maxCandidatesPerRun: number;
  /**
   * Política de aviso: a Telegram solo llega lo que tiene puntaje estrictamente
   * mayor a este valor, subastas incluidas. De eso, las mejores van una por una
   * (hasta maxNotificationsPerRun) y el resto en un único mensaje de resumen.
   * Todo queda igual en el dashboard, se avise o no.
   */
  notifyScoreAbove: number;
  maxNotificationsPerRun: number;
  /**
   * Las subastas no se avisan al encontrarlas sino cuando están por cerrar:
   * antes el precio todavía se mueve mucho y el aviso es ruido. Y solo si la
   * puja actual deja margen para ofertar por debajo del tope.
   *
   * Ojo con el cron: corre cada 15 minutos, así que con una ventana de 20 el
   * aviso llega con entre 5 y 20 minutos por delante. Una ventana menor que
   * el intervalo del cron dejaría subastas sin avisar.
   */
  auctionAlertMaxMinutesLeft: number;
  auctionAlertMaxPrice: number;
  /**
   * Vendedores cuyas subastas no se avisan. Siguen en el dashboard. Es para
   * vendedores con buenas pujas iniciales pero que casi siempre cierran por
   * encima del presupuesto: el aviso a 20 minutos del final no sirve de nada.
   */
  auctionAlertExcludedSellers: string[];
  maxAuctionAlertsPerRun: number;
  /**
   * Refresco de precio y disponibilidad. Cada publicación cuesta una llamada a
   * la Browse API (la consulta en lote no está habilitada para esta cuenta), y
   * la cuota es de 5.000 por día: con el cron cada 15 minutos, 20 por corrida
   * son ~1.900 diarias, sobre ~1.300 que ya usan las búsquedas.
   */
  refreshCallsPerRun: number;
  /** Cuánto tiempo se considera fresco un precio antes de volver a consultarlo. */
  refreshStaleMinutes: number;
  /**
   * Subastas que cierran dentro de esta ventana se refrescan siempre, antes que
   * nada: son las que se van a avisar en esta corrida o la siguiente, y el
   * aviso tiene que comparar contra la puja actual.
   */
  refreshAlertWindowMinutes: number;
  /**
   * Precio de venta sugerido al publicar: (costo eBay + publishMarkupFlatUsd) ×
   * publishMarkupMultiplier. El fijo cubre flete al casillero + envío a Perú;
   * el multiplicador es el margen. Editable acá sin redeployar.
   */
  publishMarkupFlatUsd: number;
  publishMarkupMultiplier: number;
  /** Tipo de cambio para convertir el precio de venta a soles (campo `price` de REVOLT-LAP). */
  publishUsdToPenRate: number;
  minBatteryPercent: number;
  cpuPatterns: CpuPatternConfig[];
  /**
   * CPUs que van primero: encabezan el dashboard y encabezan los avisos de
   * Telegram, siempre que superen notifyScoreAbove. Son las etiquetas de cpuPatterns.
   */
  priorityCpus: string[];
  /** Modelos "oferta especial" (ver SpecialDealConfig). */
  specialDeals: SpecialDealConfig[];
  /**
   * Vetas que corren en TODAS las corridas, fuera de la ventana rotativa. Son
   * para los modelos especiales: hay muy pocas publicaciones en todo eBay y
   * se venden rápido, así que esperar a que les toque el turno en la rotación
   * (cada ~1,5 h) es perderlas.
   */
  specialSearchProfiles: SearchProfile[];
  /**
   * Escalafón de modelos por facilidad de reventa. Gana el primero que matchea
   * el título, así que van de mejor a peor. No excluyen nada: pesan en el
   * puntaje. `modelFallbackWeight` es lo que recibe un título que no matchea
   * ninguno (líneas de consumo).
   */
  modelTiers: ModelTierConfig[];
  modelFallbackWeight: number;
  /** Restas al puntaje final (ver ScorePenaltyConfig). */
  scorePenalties: ScorePenaltyConfig[];
  /** Frases que descartan, buscadas en título + descripción. */
  excludePatterns: ExcludePatternConfig[];
  /**
   * Frases que descartan pero SOLO en el título. Van aparte porque en la
   * descripción son ruido: casi todo refurbisher incluye muletillas tipo
   * "may show signs of wear" o "may have minor scratches", y aplicarlas ahí
   * descartaría publicaciones perfectamente sanas. Cuando el vendedor tiene un
   * defecto real que declarar, lo pone en el título.
   */
  titleExcludePatterns: ExcludePatternConfig[];
}

/** Puerto: de dónde sale el SearchConfig activo (DB hoy, podría ser por-usuario mañana). */
export interface ConfigProvider {
  getConfig(): Promise<SearchConfig>;
}

// ---------------------------------------------------------------------------
// Publicación: de una oferta de eBay a la tienda propia (y, a futuro, a
// Facebook Marketplace vía el worker local de Playwright — ver el repo
// DEAL PUBLISHER, que consume la cola en la tabla `publications`).
// ---------------------------------------------------------------------------

/** Lo que devuelve resolver un link de eBay: detalle + copy ya sugerido. */
export interface ResolvedListing {
  itemId: string;
  url: string;
  title: string;
  suggestedTitle: string;
  suggestedDescription: string;
  priceUsd: number | null;
  condition: string | null;
  images: string[];
  cpuMatch: string | null;
}

/** Lo que el usuario confirma publicar, después de editar el borrador sugerido. */
export interface PublishDraft {
  itemId: string;
  ebayUrl: string;
  title: string;
  description: string;
  priceUsd: number;
  /** Precio de venta convertido a soles, para el campo `price` de REVOLT-LAP. */
  pricePen: number;
  costUsd: number;
  currency: string;
  imageUrls: string[];
  // Structured specs para las tiles de la ficha de producto. Se derivan del
  // detalle de eBay en publish-service, no los edita el usuario en el panel.
  brand: string;
  conditionGrade: string;
  processor: string | null;
  ram: string | null;
  storage: string | null;
  display: string | null;
  batteryHealth: string | null;
}

export interface StorePublishResult {
  productId: string;
  slug: string;
}

/** Puerto: publicar el borrador en la tienda propia. Un adapter por canal (tienda, mañana Marketplace directo si Meta lo habilita). */
export interface StorePublishTarget {
  publish(draft: PublishDraft): Promise<StorePublishResult>;
}

export interface PublicationStatus {
  itemId: string;
  storeSlug: string | null;
  storePublishedAt: string | null;
  facebookStatus: "none" | "queued" | "posted" | "failed" | "skipped";
}

/** Puerto: persistencia de publicaciones ya hechas (evita publicar dos veces, alimenta la cola de Facebook). */
export interface PublicationRepository {
  findStatuses(itemIds: string[]): Promise<Map<string, PublicationStatus>>;
  save(record: {
    itemId: string;
    ebayUrl: string;
    title: string;
    description: string;
    priceUsd: number;
    /** Precio en soles: es el que se le muestra a Facebook, no priceUsd (ver migración 0031). */
    pricePen: number;
    costUsd: number;
    currency: string;
    imageUrls: string[];
    store: StorePublishResult;
    queueForFacebook: boolean;
  }): Promise<void>;
}

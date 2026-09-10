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
}

export interface ListingAspect {
  name: string;
  value: string;
}

export interface ListingDetail extends ListingSummary {
  /** Descripción + shortDescription + item specifics, todo junto: es lo que
   *  evalúan las reglas y el scoring. */
  descriptionText: string;
  /** Solo la descripción del vendedor, para mostrarla tal cual en el dashboard. */
  sellerDescription: string;
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
  sellerUsername: string | null;
  sellerFeedbackScore: number | null;
  sellerFeedbackPercentage: number | null;
  /** Título normalizado + precio: detecta republicaciones del mismo equipo. */
  fingerprint: string;
  // Para la vista de detalle del dashboard.
  sellerDescription: string;
  aspects: ListingAspect[];
  additionalImages: string[];
}

/** Puerto: persistencia de ofertas ya evaluadas (hoy Supabase, mañana lo que sea). */
export interface DealRepository {
  filterUnseen(itemIds: string[]): Promise<string[]>;
  /** De las huellas dadas, cuáles ya existen como oferta calificada. */
  findKnownFingerprints(fingerprints: string[]): Promise<Set<string>>;
  save(deal: EvaluatedDeal): Promise<void>;
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

export interface ExcludePatternConfig {
  reason: string;
  pattern: string;
  flags: string;
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
   * Política de aviso: con el pool ampliado aparecen decenas de ofertas por
   * corrida, así que Telegram recibe una por una solo las ofertazas (hasta
   * maxNotificationsPerRun) y el resto va en un único mensaje de resumen.
   * Todo queda igual en el dashboard, se avise o no.
   */
  notifyOnlyGreatDeals: boolean;
  maxNotificationsPerRun: number;
  minBatteryPercent: number;
  cpuPatterns: CpuPatternConfig[];
  /**
   * CPUs que van primero: encabezan el dashboard y se avisan por Telegram
   * aunque no lleguen a "ofertaza". Son las etiquetas de cpuPatterns.
   */
  priorityCpus: string[];
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

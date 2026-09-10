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
}

export interface ListingDetail extends ListingSummary {
  descriptionText: string;
}

export interface SearchPage {
  page: number;
  pageSize: number;
}

/** Puerto: cualquier marketplace de segunda mano (eBay hoy, otro mañana). */
export interface MarketplaceClient {
  search(config: SearchConfig, page: SearchPage): Promise<ListingSummary[]>;
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
}

/** Puerto: persistencia de ofertas ya evaluadas (hoy Supabase, mañana lo que sea). */
export interface DealRepository {
  filterUnseen(itemIds: string[]): Promise<string[]>;
  save(deal: EvaluatedDeal): Promise<void>;
}

/** Puerto: un canal de notificación (Telegram hoy; push/WhatsApp mañana). */
export interface NotificationChannel {
  notify(deal: EvaluatedDeal): Promise<void>;
}

export interface RunStats {
  itemsScanned: number;
  candidatesChecked: number;
  itemsQualified: number;
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
  maxPriceUsd: number;
  greatDealMaxPrice: number;
  greatDealMinScore: number;
  includedConditionIds: number[];
  includeAuctions: boolean;
  maxPages: number;
  maxCandidatesPerRun: number;
  minBatteryPercent: number;
  cpuPatterns: CpuPatternConfig[];
  excludePatterns: ExcludePatternConfig[];
}

/** Puerto: de dónde sale el SearchConfig activo (DB hoy, podría ser por-usuario mañana). */
export interface ConfigProvider {
  getConfig(): Promise<SearchConfig>;
}

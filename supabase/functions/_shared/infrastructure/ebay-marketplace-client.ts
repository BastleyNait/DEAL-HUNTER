import type {
  ListingDetail,
  ListingStatus,
  ListingSummary,
  MarketplaceClient,
  SearchConfig,
  SearchPage,
  SearchProfile,
} from "../domain/types.ts";
import type { EbayTokenStore } from "./ebay-token-store.ts";

const EBAY_ENV = Deno.env.get("EBAY_ENV") ?? "PRODUCTION";
const IS_SANDBOX = EBAY_ENV === "SANDBOX";
const API_BASE = IS_SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

interface EbayItemSummaryDto {
  itemId: string;
  title: string;
  price?: { value: string; currency: string };
  itemWebUrl: string;
  image?: { imageUrl: string };
  condition?: string;
  conditionId?: string;
  buyingOptions?: string[];
  shortDescription?: string;
  itemEndDate?: string;
  seller?: { username?: string; feedbackScore?: number; feedbackPercentage?: string };
  // En subastas, la búsqueda no trae `price`: la puja actual viene acá.
  currentBidPrice?: { value: string; currency: string };
  bidCount?: number;
  estimatedAvailabilities?: { estimatedAvailabilityStatus?: string }[];
}

interface EbayItemDetailDto extends EbayItemSummaryDto {
  description?: string;
  localizedAspects?: { type?: string; name?: string; value?: string }[];
  additionalImages?: { imageUrl?: string }[];
}

// Las descripciones de eBay suelen ser plantillas gigantes; con esto alcanza de
// sobra para leer lo que el vendedor realmente dice del equipo.
const MAX_DESCRIPTION_CHARS = 4000;
const MAX_DESCRIPTION_HTML_CHARS = 20000;

/**
 * Primera capa de saneamiento, del lado del servidor: saca los bloques que
 * ejecutan o cargan cosas, los manejadores de eventos y las URLs javascript:.
 * No es la única defensa — el dashboard vuelve a sanear con DOMPurify antes de
 * renderizar — pero evita que markup hostil llegue siquiera a la base.
 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|svg|link|meta|form|base)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(script|style|iframe|object|embed|svg|link|meta|form|base)\b[^>]*\/?>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*'|javascript:[^\s>]*)/gi, "")
    .slice(0, MAX_DESCRIPTION_HTML_CHARS);
}

function toListingSummary(dto: EbayItemSummaryDto): ListingSummary {
  return {
    id: dto.itemId,
    title: dto.title,
    price: currentPrice(dto),
    currency: (dto.currentBidPrice ?? dto.price)?.currency ?? "USD",
    url: dto.itemWebUrl,
    imageUrl: dto.image?.imageUrl ?? null,
    condition: dto.condition ?? null,
    conditionId: dto.conditionId ?? null,
    buyingOptions: dto.buyingOptions ?? [],
    shortDescription: stripHtml(dto.shortDescription ?? ""),
    endDate: dto.itemEndDate ?? null,
    sellerUsername: dto.seller?.username ?? null,
    sellerFeedbackScore: dto.seller?.feedbackScore ?? null,
    // eBay lo manda como string ("99.8").
    sellerFeedbackPercentage: parseNumber(dto.seller?.feedbackPercentage),
    bidCount: dto.bidCount ?? null,
  };
}

/**
 * En una subasta vale la puja actual. La búsqueda de eBay no manda `price`
 * para subastas, solo `currentBidPrice`, así que leer únicamente `price`
 * dejaba el precio en null hasta traer el detalle.
 */
function currentPrice(dto: EbayItemSummaryDto): number | null {
  const money = dto.currentBidPrice ?? dto.price;
  return money ? parseNumber(money.value) : null;
}

function parseNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** "Processor: Intel Core i5-1135G7" y demás item specifics, como texto plano. */
function aspectsToText(dto: EbayItemDetailDto): string {
  return (dto.localizedAspects ?? [])
    .map((a) => `${a.name ?? ""}: ${a.value ?? ""}`)
    .join(". ");
}

function buildFilter(config: SearchConfig): string {
  // El techo de precio va hasta refurbishedExceptionMaxPrice (>= maxPriceUsd)
  // para que eBay nos devuelva también los reacondicionados con Best Offer que
  // se evalúan en priceEligibilityRule; el resto de los casos se filtran ahí.
  const priceCeiling = Math.max(config.maxPriceUsd, config.refurbishedExceptionMaxPrice);
  const parts = [
    `price:[..${priceCeiling}]`,
    `priceCurrency:USD`,
    `conditionIds:{${config.includedConditionIds.join("|")}}`,
    `buyingOptions:{${config.includeAuctions ? "FIXED_PRICE|AUCTION" : "FIXED_PRICE"}}`,
    `deliveryCountry:${config.deliveryCountry}`,
  ];
  return parts.join(",");
}

/** Adaptador de eBay Browse API al puerto MarketplaceClient. */
export class EbayMarketplaceClient implements MarketplaceClient {
  constructor(private readonly tokenStore: EbayTokenStore) {}

  async search(config: SearchConfig, profile: SearchProfile, page: SearchPage): Promise<ListingSummary[]> {
    const token = await this.tokenStore.getValidToken();
    const url = new URL(`${API_BASE}/buy/browse/v1/item_summary/search`);
    url.searchParams.set("q", profile.query);
    const categoryId = profile.categoryId === undefined ? config.categoryId : profile.categoryId;
    if (categoryId) url.searchParams.set("category_ids", categoryId);
    url.searchParams.set("filter", buildFilter(config));
    url.searchParams.set("sort", profile.sort);
    url.searchParams.set("limit", String(page.pageSize));
    url.searchParams.set("offset", String(page.page * page.pageSize));
    // Trae shortDescription sin costo extra de llamadas: se usa para matchear
    // CPU y pre-descartar antes de gastar una llamada de detalle.
    url.searchParams.set("fieldgroups", "EXTENDED");

    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": config.marketplaceId,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`eBay search error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { itemSummaries?: EbayItemSummaryDto[] };
    return (json.itemSummaries ?? []).map(toListingSummary);
  }

  async getDetail(id: string): Promise<ListingDetail> {
    const token = await this.tokenStore.getValidToken();
    const url = `${API_BASE}/buy/browse/v1/item/${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        // El marketplace es fijo acá porque getDetail no recibe SearchConfig;
        // si algún día hace falta multi-marketplace, se pasa como parámetro.
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      throw new Error(`eBay getItem error ${res.status}: ${await res.text()}`);
    }

    const dto = (await res.json()) as EbayItemDetailDto;
    const summary = toListingSummary(dto);
    const sellerDescription = stripHtml(dto.description ?? "").slice(0, MAX_DESCRIPTION_CHARS);
    const aspects = (dto.localizedAspects ?? [])
      .filter((a) => a.name && a.value)
      .map((a) => ({ name: a.name!, value: a.value! }));

    // Los item specifics (Processor, Battery, RAM...) suelen tener datos que no
    // están en la descripción libre, así que entran al mismo texto que evalúan
    // las reglas y el scoring.
    const descriptionText = [sellerDescription, summary.shortDescription, aspectsToText(dto)]
      .filter((part) => part.length > 0)
      .join(". ");

    return {
      ...summary,
      descriptionText,
      sellerDescription,
      sellerDescriptionHtml: sanitizeHtml(dto.description ?? ""),
      aspects,
      additionalImages: (dto.additionalImages ?? [])
        .map((img) => img.imageUrl)
        .filter((url): url is string => Boolean(url)),
    };
  }

  async getStatus(id: string): Promise<ListingStatus> {
    const token = await this.tokenStore.getValidToken();
    const res = await fetch(`${API_BASE}/buy/browse/v1/item/${encodeURIComponent(id)}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Content-Type": "application/json",
      },
    });

    // eBay devuelve 404 (errorId 11001) cuando la publicación terminó o se
    // borró. No es un error del refresco: es la respuesta.
    if (res.status === 404) {
      await res.body?.cancel();
      return { id, available: false, price: null, bidCount: null, endDate: null };
    }
    if (!res.ok) {
      throw new Error(`eBay getItem error ${res.status}: ${await res.text()}`);
    }

    const dto = (await res.json()) as EbayItemDetailDto;
    // Una publicación vendida sigue respondiendo 200, pero con disponibilidad
    // OUT_OF_STOCK. Verificado contra la API real con una ThinkPad vendida.
    const outOfStock = (dto.estimatedAvailabilities ?? []).some(
      (a) => a.estimatedAvailabilityStatus === "OUT_OF_STOCK",
    );
    const ended = dto.itemEndDate ? new Date(dto.itemEndDate).getTime() <= Date.now() : false;

    return {
      id,
      available: !outOfStock && !ended,
      price: currentPrice(dto),
      bidCount: dto.bidCount ?? null,
      endDate: dto.itemEndDate ?? null,
    };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

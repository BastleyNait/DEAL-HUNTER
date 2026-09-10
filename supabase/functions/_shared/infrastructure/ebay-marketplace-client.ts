import type {
  ListingDetail,
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
}

interface EbayItemDetailDto extends EbayItemSummaryDto {
  description?: string;
  localizedAspects?: { type?: string; name?: string; value?: string }[];
}

function toListingSummary(dto: EbayItemSummaryDto): ListingSummary {
  return {
    id: dto.itemId,
    title: dto.title,
    price: dto.price ? Number(dto.price.value) : null,
    currency: dto.price?.currency ?? "USD",
    url: dto.itemWebUrl,
    imageUrl: dto.image?.imageUrl ?? null,
    condition: dto.condition ?? null,
    conditionId: dto.conditionId ?? null,
    buyingOptions: dto.buyingOptions ?? [],
    shortDescription: stripHtml(dto.shortDescription ?? ""),
    endDate: dto.itemEndDate ?? null,
  };
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
    // Los item specifics (Processor, Battery, RAM...) suelen tener datos que no
    // están en la descripción libre, así que entran al mismo texto que evalúan
    // las reglas y el scoring.
    const descriptionText = [stripHtml(dto.description ?? ""), summary.shortDescription, aspectsToText(dto)]
      .filter((part) => part.length > 0)
      .join(". ");

    return { ...summary, descriptionText };
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

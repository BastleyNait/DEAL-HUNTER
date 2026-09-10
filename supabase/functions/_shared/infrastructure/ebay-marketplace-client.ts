import type { ListingDetail, ListingSummary, MarketplaceClient, SearchConfig, SearchPage } from "../domain/types.ts";
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
}

interface EbayItemDetailDto extends EbayItemSummaryDto {
  description?: string;
  shortDescription?: string;
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
  };
}

function buildFilter(config: SearchConfig): string {
  const parts = [
    `price:[..${config.maxPriceUsd}]`,
    `priceCurrency:USD`,
    `conditionIds:{${config.includedConditionIds.join("|")}}`,
    `buyingOptions:{${config.includeAuctions ? "FIXED_PRICE|AUCTION" : "FIXED_PRICE"}}`,
  ];
  return parts.join(",");
}

/** Adaptador de eBay Browse API al puerto MarketplaceClient. */
export class EbayMarketplaceClient implements MarketplaceClient {
  constructor(private readonly tokenStore: EbayTokenStore) {}

  async search(config: SearchConfig, page: SearchPage): Promise<ListingSummary[]> {
    const token = await this.tokenStore.getValidToken();
    const url = new URL(`${API_BASE}/buy/browse/v1/item_summary/search`);
    url.searchParams.set("q", "laptop");
    url.searchParams.set("category_ids", config.categoryId);
    url.searchParams.set("filter", buildFilter(config));
    url.searchParams.set("sort", "newlyListed");
    url.searchParams.set("limit", String(page.pageSize));
    url.searchParams.set("offset", String(page.page * page.pageSize));

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
    return {
      ...toListingSummary(dto),
      descriptionText: stripHtml(dto.description ?? dto.shortDescription ?? ""),
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

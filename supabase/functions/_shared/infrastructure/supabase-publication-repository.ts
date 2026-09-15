import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { PublicationRepository, PublicationStatus, StorePublishResult } from "../domain/types.ts";

export class SupabasePublicationRepository implements PublicationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findStatuses(itemIds: string[]): Promise<Map<string, PublicationStatus>> {
    if (itemIds.length === 0) return new Map();
    const { data, error } = await this.supabase
      .from("publications")
      .select("item_id, store_slug, store_published_at, facebook_status")
      .in("item_id", itemIds);
    if (error) throw new Error(`No se pudo consultar publications: ${error.message}`);

    return new Map(
      (data ?? []).map((row) => [
        row.item_id as string,
        {
          itemId: row.item_id,
          storeSlug: row.store_slug,
          storePublishedAt: row.store_published_at,
          facebookStatus: row.facebook_status,
        } satisfies PublicationStatus,
      ]),
    );
  }

  async save(record: {
    itemId: string;
    ebayUrl: string;
    title: string;
    description: string;
    priceUsd: number;
    costUsd: number;
    currency: string;
    imageUrls: string[];
    store: StorePublishResult;
    queueForFacebook: boolean;
  }): Promise<void> {
    const { error } = await this.supabase.from("publications").upsert({
      item_id: record.itemId,
      ebay_url: record.ebayUrl,
      title: record.title,
      description: record.description,
      price_usd: record.priceUsd,
      cost_usd: record.costUsd,
      currency: record.currency,
      image_urls: record.imageUrls,
      store_product_id: record.store.productId,
      store_slug: record.store.slug,
      store_published_at: new Date().toISOString(),
      facebook_status: record.queueForFacebook ? "queued" : "none",
    });
    if (error) throw new Error(`No se pudo guardar la publicación: ${error.message}`);
  }
}

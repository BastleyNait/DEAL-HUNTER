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

  async queueForFacebook(itemIds?: string[]): Promise<number> {
    // Sin ids: solo las fallidas (el "reintentar todo"). Con ids: las que no
    // estén ya en cola o posteadas, para que un doble click no duplique.
    let query = this.supabase
      .from("publications")
      .update({ facebook_status: "queued", facebook_error: null })
      .in("facebook_status", itemIds && itemIds.length > 0 ? ["none", "failed", "skipped"] : ["failed"]);
    if (itemIds && itemIds.length > 0) query = query.in("item_id", itemIds);

    const { data, error } = await query.select("item_id");
    if (error) throw new Error(`No se pudo encolar para Facebook: ${error.message}`);
    return data?.length ?? 0;
  }

  async save(record: {
    itemId: string;
    ebayUrl: string;
    title: string;
    description: string;
    priceUsd: number;
    pricePen: number;
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
      price_pen: record.pricePen,
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

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { DealRepository, EvaluatedDeal } from "../domain/types.ts";

export class SupabaseDealRepository implements DealRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async filterUnseen(itemIds: string[]): Promise<string[]> {
    if (itemIds.length === 0) return [];
    const { data } = await this.supabase.from("seen_listings").select("item_id").in("item_id", itemIds);
    const seen = new Set((data ?? []).map((r) => r.item_id as string));
    return itemIds.filter((id) => !seen.has(id));
  }

  async findKnownFingerprints(fingerprints: string[]): Promise<Set<string>> {
    if (fingerprints.length === 0) return new Set();
    const { data } = await this.supabase
      .from("seen_listings")
      .select("fingerprint")
      .eq("qualified", true)
      .in("fingerprint", fingerprints);
    return new Set((data ?? []).map((r) => r.fingerprint as string));
  }

  async findAuctionsToAlert(options: {
    maxPrice: number;
    maxHoursLeft: number;
    limit: number;
  }): Promise<EvaluatedDeal[]> {
    const now = Date.now();
    const until = new Date(now + options.maxHoursLeft * 3_600_000).toISOString();

    const { data } = await this.supabase
      .from("seen_listings")
      .select("*")
      .eq("qualified", true)
      .eq("is_auction", true)
      .is("auction_alerted_at", null)
      .not("end_date", "is", null)
      .lte("price", options.maxPrice)
      // Ya dentro de la ventana y todavía abierta.
      .lte("end_date", until)
      .gt("end_date", new Date(now).toISOString())
      .order("end_date", { ascending: true })
      .limit(options.limit);

    return (data ?? []).map((row) => ({
      itemId: row.item_id,
      title: row.title,
      price: row.price === null ? null : Number(row.price),
      currency: row.currency,
      condition: row.condition,
      cpuMatch: row.cpu_match,
      url: row.url,
      imageUrl: row.image_url,
      qualified: row.qualified,
      rejectReason: row.reject_reason ?? undefined,
      score: row.score === null ? null : Number(row.score),
      isGreatDeal: row.is_great_deal,
      isPriority: row.is_priority,
      hasDescription: row.has_description,
      hasBatteryInfo: row.has_battery_info,
      batteryGrade: row.battery_grade,
      isAuction: row.is_auction,
      hasBestOffer: row.has_best_offer,
      endDate: row.end_date,
      sellerUsername: row.seller_username,
      sellerFeedbackScore: row.seller_feedback_score,
      sellerFeedbackPercentage: row.seller_feedback_percentage,
      sellerDescription: row.seller_description ?? "",
      sellerDescriptionHtml: row.seller_description_html ?? "",
      aspects: row.aspects ?? [],
      additionalImages: row.additional_images ?? [],
      fingerprint: row.fingerprint ?? "",
    }));
  }

  async markAuctionsAlerted(itemIds: string[]): Promise<void> {
    if (itemIds.length === 0) return;
    await this.supabase
      .from("seen_listings")
      .update({ auction_alerted_at: new Date().toISOString() })
      .in("item_id", itemIds);
  }

  async save(deal: EvaluatedDeal): Promise<void> {
    await this.supabase.from("seen_listings").upsert({
      item_id: deal.itemId,
      title: deal.title,
      price: deal.price,
      currency: deal.currency,
      condition: deal.condition,
      cpu_match: deal.cpuMatch,
      qualified: deal.qualified,
      reject_reason: deal.rejectReason ?? null,
      url: deal.url,
      image_url: deal.imageUrl,
      score: deal.score,
      is_great_deal: deal.isGreatDeal,
      is_priority: deal.isPriority,
      has_description: deal.hasDescription,
      has_battery_info: deal.hasBatteryInfo,
      battery_grade: deal.batteryGrade,
      is_auction: deal.isAuction,
      has_best_offer: deal.hasBestOffer,
      end_date: deal.endDate,
      seller_description: deal.sellerDescription,
      seller_description_html: deal.sellerDescriptionHtml,
      aspects: deal.aspects,
      additional_images: deal.additionalImages,
      seller_username: deal.sellerUsername,
      seller_feedback_score: deal.sellerFeedbackScore,
      seller_feedback_percentage: deal.sellerFeedbackPercentage,
      fingerprint: deal.fingerprint,
      notified_at: deal.qualified ? new Date().toISOString() : null,
    });
  }
}

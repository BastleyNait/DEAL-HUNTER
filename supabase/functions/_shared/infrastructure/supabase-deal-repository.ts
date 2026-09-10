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
      has_description: deal.hasDescription,
      has_battery_info: deal.hasBatteryInfo,
      battery_grade: deal.batteryGrade,
      is_auction: deal.isAuction,
      has_best_offer: deal.hasBestOffer,
      end_date: deal.endDate,
      seller_description: deal.sellerDescription,
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

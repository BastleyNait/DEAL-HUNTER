import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { DealRepository, EvaluatedDeal, ListingStatus } from "../domain/types.ts";

/**
 * PostgREST manda los filtros en la URL (`?item_id=in.(a,b,c...)`). Con ~1.500
 * candidatos por corrida esa URL supera los 8 KB que aguanta el gateway y la
 * petición se cae entera. Como el error se ignoraba, el resultado era una lista
 * vacía de "ya vistos": todo parecía nuevo y se volvía a avisar de lo mismo
 * corrida tras corrida. De ahí venían las ThinkPads repetidas.
 */
const FILTER_CHUNK = 120;

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class SupabaseDealRepository implements DealRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async filterUnseen(itemIds: string[]): Promise<string[]> {
    if (itemIds.length === 0) return [];
    const seen = new Set<string>();
    for (const batch of chunked(itemIds, FILTER_CHUNK)) {
      const { data, error } = await this.supabase
        .from("seen_listings")
        .select("item_id")
        .in("item_id", batch);
      // Se propaga en vez de seguir con datos incompletos: tratar como nuevo
      // algo que ya se avisó es justo el error que hay que evitar.
      if (error) throw new Error(`No se pudo consultar lo ya visto: ${error.message}`);
      for (const row of data ?? []) seen.add(row.item_id as string);
    }
    return itemIds.filter((id) => !seen.has(id));
  }

  async findKnownFingerprints(fingerprints: string[]): Promise<Set<string>> {
    if (fingerprints.length === 0) return new Set();
    const known = new Set<string>();
    // Las huellas son títulos enteros normalizados, así que ocupan mucho más
    // que un item_id en la URL: van de a menos.
    for (const batch of chunked(fingerprints, Math.floor(FILTER_CHUNK / 4))) {
      const { data, error } = await this.supabase
        .from("seen_listings")
        .select("fingerprint")
        .eq("qualified", true)
        .in("fingerprint", batch);
      if (error) throw new Error(`No se pudieron consultar las huellas: ${error.message}`);
      for (const row of data ?? []) known.add(row.fingerprint as string);
    }
    return known;
  }

  async findAuctionsToAlert(options: {
    maxPrice: number;
    maxMinutesLeft: number;
    scoreAbove: number;
    excludedSellers: string[];
    limit: number;
  }): Promise<EvaluatedDeal[]> {
    const now = Date.now();
    const until = new Date(now + options.maxMinutesLeft * 60_000).toISOString();

    let query = this.supabase
      .from("seen_listings")
      .select("*")
      .eq("qualified", true)
      .eq("is_auction", true)
      .eq("is_available", true)
      .is("auction_alerted_at", null)
      .not("end_date", "is", null)
      .lte("price", options.maxPrice)
      // En la consulta y no después: el límite por corrida se aplica sobre lo
      // que ya pasó el umbral, no se gasta en subastas que no se iban a avisar.
      // Las especiales pasan sin umbral de puntaje. PostgREST combina con AND
      // este or() y el de vendedores excluidos de más abajo.
      // Las de prioridad baja (Dell) no se saltan el umbral.
      .or(`score.gt.${options.scoreAbove},and(special_label.not.is.null,special_demoted.eq.false)`)
      // Ya dentro de la ventana y todavía abierta.
      .lte("end_date", until)
      .gt("end_date", new Date(now).toISOString())
      .order("end_date", { ascending: true })
      .limit(options.limit);

    if (options.excludedSellers.length > 0) {
      // Comillas en cada valor para que un guion o un punto en el nombre no
      // rompa la lista de PostgREST. Sin vendedor conocido no se excluye.
      const list = options.excludedSellers.map((s) => `"${s}"`).join(",");
      query = query.or(`seller_username.is.null,seller_username.not.in.(${list})`);
    }

    const { data, error } = await query;
    if (error) throw new Error(`No se pudieron buscar las subastas por cerrar: ${error.message}`);

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
      specialLabel: row.special_label ?? null,
      specialDemoted: row.special_demoted ?? false,
      isUrgent: row.is_urgent ?? false,
      hasDescription: row.has_description,
      hasBatteryInfo: row.has_battery_info,
      batteryGrade: row.battery_grade,
      isAuction: row.is_auction,
      hasBestOffer: row.has_best_offer,
      endDate: row.end_date,
      bidCount: row.bid_count,
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
    await this.stamp(itemIds, "auction_alerted_at");
  }

  async findNotifiableKeys(itemIds: string[]): Promise<Map<string, string>> {
    if (itemIds.length === 0) return new Map();
    // La decisión vive en Postgres (filter_notifiable) y no acá: cruzar lo
    // visto en el dashboard con lo ya avisado es un join, y traerse las dos
    // tablas enteras a Deno para hacerlo a mano sería peor en todo sentido.
    // Va por POST, así que acá no hay límite de largo de URL que respetar.
    const { data, error } = await this.supabase.rpc("filter_notifiable", { p_item_ids: itemIds });
    if (error) throw new Error(`No se pudo filtrar lo ya avisado: ${error.message}`);
    return new Map((data ?? []).map((r: { item_id: string; model_key: string }) => [r.item_id, r.model_key]));
  }

  async markNotified(itemIds: string[]): Promise<void> {
    await this.stamp(itemIds, "notified_at");
  }

  async findListingsToRefresh(options: {
    limit: number;
    staleMinutes: number;
    alertWindowMinutes: number;
    alertMaxPrice: number;
    scoreAbove: number;
    excludedSellers: string[];
  }): Promise<string[]> {
    if (options.limit <= 0) return [];
    // La priorización vive en Postgres (find_listings_to_refresh): son tres
    // conjuntos con órdenes distintos intercalados, que en SQL es una consulta
    // y acá serían tres idas y vueltas.
    const { data, error } = await this.supabase.rpc("find_listings_to_refresh", {
      p_limit: options.limit,
      p_stale_minutes: options.staleMinutes,
      p_alert_window_minutes: options.alertWindowMinutes,
      p_alert_max_price: options.alertMaxPrice,
      p_score_above: options.scoreAbove,
      p_excluded_sellers: options.excludedSellers,
    });
    if (error) throw new Error(`No se pudo elegir qué refrescar: ${error.message}`);
    return (data ?? []).map((r: { item_id: string }) => r.item_id);
  }

  async applyStatuses(statuses: ListingStatus[]): Promise<number> {
    if (statuses.length === 0) return 0;
    const rows = statuses.map((s) => ({
      item_id: s.id,
      available: s.available,
      price: s.price,
      bid_count: s.bidCount,
      end_date: s.endDate,
    }));
    const { data, error } = await this.supabase.rpc("apply_listing_status", { p_rows: rows });
    if (error) throw new Error(`No se pudo guardar el estado refrescado: ${error.message}`);
    return Number(data ?? 0);
  }

  /** Pone la fecha de ahora en una columna, de a tandas y sin tragarse errores. */
  private async stamp(itemIds: string[], column: "notified_at" | "auction_alerted_at"): Promise<void> {
    if (itemIds.length === 0) return;
    const now = new Date().toISOString();
    for (const batch of chunked(itemIds, FILTER_CHUNK)) {
      const { error } = await this.supabase
        .from("seen_listings")
        .update({ [column]: now })
        .in("item_id", batch);
      if (error) throw new Error(`No se pudo marcar ${column}: ${error.message}`);
    }
  }

  async save(deal: EvaluatedDeal): Promise<void> {
    const { error } = await this.supabase.from("seen_listings").upsert({
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
      special_label: deal.specialLabel,
      special_demoted: deal.specialDemoted,
      is_urgent: deal.isUrgent,
      has_description: deal.hasDescription,
      has_battery_info: deal.hasBatteryInfo,
      battery_grade: deal.batteryGrade,
      is_auction: deal.isAuction,
      has_best_offer: deal.hasBestOffer,
      end_date: deal.endDate,
      bid_count: deal.bidCount,
      // Recién consultado a eBay para evaluarlo: el precio es fresco.
      price_checked_at: new Date().toISOString(),
      seller_description: deal.sellerDescription,
      seller_description_html: deal.sellerDescriptionHtml,
      aspects: deal.aspects,
      additional_images: deal.additionalImages,
      seller_username: deal.sellerUsername,
      seller_feedback_score: deal.sellerFeedbackScore,
      seller_feedback_percentage: deal.sellerFeedbackPercentage,
      fingerprint: deal.fingerprint,
      // notified_at queda fuera del upsert a propósito: lo escribe
      // markNotified() recién cuando el mensaje salió bien. Antes se marcaba
      // acá, al guardar, así que la columna decía "calificó" en vez de "se
      // avisó" y no servía para no repetir.
    });
    // Un guardado que falla en silencio deja el ítem como "no visto" para
    // siempre: se vuelve a encontrar, a evaluar y a avisar en cada corrida.
    if (error) throw new Error(`No se pudo guardar ${deal.itemId}: ${error.message}`);
  }
}

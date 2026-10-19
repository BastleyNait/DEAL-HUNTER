import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * La cola de "compradas por publicar" (tabla purchases, ver migración 0047).
 * La escriben telegram-webhook (al tocar "🛒 La compro") y publish-deal (link
 * agregado a mano, quitar de la cola, borrador cacheado).
 */

/** "v1|366734274292|0" -> "366734274292". */
export function legacyIdFromItemId(itemId: string): string | null {
  return itemId.match(/^v1\|(\d+)\|/)?.[1] ?? null;
}

/** Cualquier link de eBay con /itm/ (con o sin slug, parámetros, ebay.io resuelto). */
export function legacyIdFromUrl(url: string): string | null {
  return url.match(/\/itm\/(?:[^/?#]*\/)?(\d{9,15})/)?.[1] ?? url.trim().match(/^(\d{9,15})$/)?.[1] ?? null;
}

export async function recordPurchase(
  supabase: SupabaseClient,
  input: { itemId: string; url?: string | null; source: "telegram" | "manual"; boughtBy?: string | null; boughtAt?: string },
): Promise<string> {
  const legacyId = legacyIdFromItemId(input.itemId) ?? legacyIdFromUrl(input.url ?? "");
  if (!legacyId) throw new Error(`No se reconoce la publicación de eBay: ${input.itemId || input.url}`);
  const { error } = await supabase.from("purchases").upsert(
    {
      legacy_id: legacyId,
      item_id: input.itemId.startsWith("v1|") ? input.itemId : `v1|${legacyId}|0`,
      url: input.url || `https://www.ebay.com/itm/${legacyId}`,
      source: input.source,
      bought_by: input.boughtBy ?? null,
      ...(input.boughtAt ? { bought_at: input.boughtAt } : {}),
      // Si se había quitado de la cola y se vuelve a marcar, reaparece.
      dismissed_at: null,
    },
    { onConflict: "legacy_id" },
  );
  if (error) throw new Error(`No se pudo registrar la compra ${legacyId}: ${error.message}`);
  return legacyId;
}

/**
 * Deshacer "La compro" desde Telegram: solo saca la compra si vino de Telegram
 * y todavía no se publicó (si ya está en la tienda, el registro se queda).
 */
export async function removeTelegramPurchase(supabase: SupabaseClient, itemId: string): Promise<void> {
  const legacyId = legacyIdFromItemId(itemId);
  if (!legacyId) return;
  const { data: published } = await supabase.from("publications").select("item_id").eq("item_id", itemId).maybeSingle();
  if (published) return;
  await supabase.from("purchases").delete().eq("legacy_id", legacyId).eq("source", "telegram");
}

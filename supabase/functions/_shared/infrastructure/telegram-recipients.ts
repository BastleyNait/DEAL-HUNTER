import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Quién recibe los avisos de Telegram vive en la tabla telegram_recipients,
 * no en la secret TELEGRAM_CHAT_ID — esa lista se manejaba antes editando el
 * secreto a mano por cada persona nueva, y no había forma de "aprobar" o
 * "quitar" sin redeployar. TELEGRAM_CHAT_ID sigue existiendo, pero ahora es
 * solo la semilla: la primera vez que se usa, cada id de esa lista se copia a
 * la tabla (el primero como dueño), y de ahí en más la tabla manda.
 *
 * ensureBootstrapped() se llama antes de cualquier lectura/escritura real:
 * es barata (upserts con ON CONFLICT DO NOTHING) y así no hace falta una
 * migración de datos aparte ni que nadie corra nada a mano.
 */
export async function ensureBootstrapped(supabase: SupabaseClient): Promise<void> {
  const seedIds = (Deno.env.get("TELEGRAM_CHAT_ID") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (seedIds.length === 0) return;

  const rows = seedIds.map((chatId, index) => ({
    chat_id: chatId,
    status: "approved",
    is_owner: index === 0,
    name: index === 0 ? "Dueño" : null,
  }));

  // ignoreDuplicates: si la fila ya existe (aprobada, revocada, lo que sea),
  // se respeta lo que ya se decidió — esto es solo para el primer arranque.
  const { error } = await supabase.from("telegram_recipients").upsert(rows, { onConflict: "chat_id", ignoreDuplicates: true });
  if (error) console.error("No se pudo sembrar telegram_recipients:", error.message);
}

export async function getApprovedChatIds(supabase: SupabaseClient): Promise<string[]> {
  await ensureBootstrapped(supabase);
  const { data, error } = await supabase.from("telegram_recipients").select("chat_id").eq("status", "approved");
  if (error) throw new Error(`No se pudo leer telegram_recipients: ${error.message}`);
  return (data ?? []).map((r) => r.chat_id as string);
}

export async function getOwnerChatId(supabase: SupabaseClient): Promise<string | null> {
  await ensureBootstrapped(supabase);
  const { data, error } = await supabase.from("telegram_recipients").select("chat_id").eq("is_owner", true).maybeSingle();
  if (error) throw new Error(`No se pudo leer el dueño: ${error.message}`);
  return data?.chat_id ?? null;
}

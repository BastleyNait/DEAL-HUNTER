import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * Botones "🛒 La compro" / "👎 Paso" de cada alerta, y el pie que muestra quién
 * reaccionó. Compartido entre quien manda la alerta (el canal de Telegram) y
 * quien recibe el toque del botón (telegram-webhook), para que el formato de
 * los botones y del pie sea uno solo.
 *
 * callback_data tiene un tope de 64 bytes; "deal:buy:v1|123456789012|0" entra
 * de sobra.
 */
export type DealReaction = "buy" | "skip";

export interface ReactionRow {
  chat_id: string;
  name: string | null;
  reaction: DealReaction;
}

export function dealKeyboard(itemId: string) {
  return {
    inline_keyboard: [
      [
        { text: "🛒 La compro", callback_data: `deal:buy:${itemId}` },
        { text: "👎 Paso", callback_data: `deal:skip:${itemId}` },
      ],
    ],
  };
}

/** Líneas que se agregan al final de la alerta, iguales en el chat de todos. */
export function reactionFooter(reactions: ReactionRow[]): string {
  const buyer = reactions.find((r) => r.reaction === "buy");
  const skipped = reactions.filter((r) => r.reaction === "skip").map((r) => r.name ?? "alguien");
  const lines: string[] = [];
  if (buyer) lines.push(`🛒 <b>${escape(buyer.name ?? "alguien")} la está comprando</b>`);
  if (skipped.length) lines.push(`👎 ${skipped.map(escape).join(", ")} ${skipped.length === 1 ? "pasó" : "pasaron"}`);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

/** Guarda qué mensaje le llegó a cada chat, para poder editarlos todos juntos después. */
export async function recordAlertMessages(
  supabase: SupabaseClient,
  itemId: string,
  text: string,
  sent: { chatId: string; messageId: number }[],
): Promise<void> {
  if (sent.length === 0) return;
  const { error } = await supabase.from("telegram_alert_messages").upsert(
    sent.map((s) => ({ item_id: itemId, chat_id: s.chatId, message_id: s.messageId, text })),
    { onConflict: "item_id,chat_id" },
  );
  // Que falle esto no puede frenar el aviso: sin la fila, los botones igual
  // registran la reacción, solo que no se edita el mensaje de los demás.
  if (error) console.error(`No se pudieron guardar los mensajes de la alerta ${itemId}:`, error.message);
}

function escape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

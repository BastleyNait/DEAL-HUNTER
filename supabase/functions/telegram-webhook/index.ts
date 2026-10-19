import { createClient } from "npm:@supabase/supabase-js@2";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ensureBootstrapped, getOwnerChatId } from "../_shared/infrastructure/telegram-recipients.ts";
import { escapeHtml } from "../_shared/infrastructure/telegram-notification-channel.ts";
import {
  dealKeyboard,
  reactionFooter,
  type DealReaction,
  type ReactionRow,
} from "../_shared/infrastructure/telegram-deal-reactions.ts";

/**
 * Recibe los mensajes que le llegan al bot y los botones que se tocan
 * ("webhook" de Telegram — Telegram le pega a esta URL cada vez que pasa
 * algo, en vez de que alguien tenga que ir a preguntarle). Cubre:
 *
 *  - Alguien nuevo le escribe al bot -> queda "pending" y el dueño recibe un
 *    mensaje con botones Aprobar/Rechazar.
 *  - El dueño toca un botón -> se actualiza el acceso y el mensaje se
 *    convierte en un toggle (aprobado <-> con botón para quitarlo, y
 *    viceversa), y se le avisa a la persona afectada.
 *  - El dueño manda /lista -> panel con todos los que pidieron acceso alguna
 *    vez, cada uno con su botón para aprobar/quitar en el momento.
 *
 * Autenticado con el secret_token que Telegram manda en cada webhook (se
 * configura al registrar el webhook, ver telegram-admin) — sin esto,
 * cualquiera que adivine la URL podría mandar "updates" falsos.
 */
interface TelegramChat {
  id: number;
  type: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
}
interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name?: string; last_name?: string };
  message?: { message_id: number; chat: TelegramChat };
  data?: string;
}
interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

type InlineKeyboard = { inline_keyboard: { text: string; callback_data: string }[][] };

Deno.serve(async (req) => {
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!webhookSecret || req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  // 200 siempre a partir de acá: si algo falla del lado nuestro, Telegram no
  // tiene que reintentar en bucle — el próximo mensaje de la persona alcanza.
  if (!botToken) return new Response("ok");

  let update: TelegramUpdate;
  try {
    update = await req.json();
  } catch {
    return new Response("ok");
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  await ensureBootstrapped(supabase);

  try {
    if (update.message) await handleMessage(supabase, botToken, update.message);
    else if (update.callback_query) await handleCallback(supabase, botToken, update.callback_query);
  } catch (err) {
    console.error("Error procesando update de Telegram:", err);
  }

  return new Response("ok");
});

async function handleMessage(supabase: SupabaseClient, botToken: string, message: TelegramMessage): Promise<void> {
  const chat = message.chat;
  if (chat.type !== "private") return; // Grupos/canales quedan afuera de este flujo de a una persona.

  const chatId = String(chat.id);
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "(sin nombre)";
  const username = chat.username ? `@${chat.username}` : null;
  const ownerChatId = await getOwnerChatId(supabase);

  if (chatId === ownerChatId) {
    const text = (message.text ?? "").trim().toLowerCase();
    if (text === "/lista" || text === "/personas") await sendRecipientsPanel(supabase, botToken, chatId);
    return;
  }

  const { data: existing } = await supabase.from("telegram_recipients").select("status").eq("chat_id", chatId).maybeSingle();

  if (!existing) {
    await supabase.from("telegram_recipients").insert({ chat_id: chatId, name, username, status: "pending" });
    if (ownerChatId) {
      await sendMessage(
        botToken,
        ownerChatId,
        `🔔 <b>${escapeHtml(name)}</b>${username ? ` (${escapeHtml(username)})` : ""} quiere recibir tus ofertas.`,
        {
          inline_keyboard: [
            [
              { text: "✅ Aprobar", callback_data: `approve:${chatId}` },
              { text: "🚫 Rechazar", callback_data: `reject:${chatId}` },
            ],
          ],
        },
      );
    }
    await sendMessage(botToken, chatId, "Listo, le avisé al dueño del bot. Esperá su confirmación 🙂");
    return;
  }

  if (existing.status === "pending") {
    await sendMessage(botToken, chatId, "Todavía no te confirmaron el acceso, paciencia 🙂");
  } else if (existing.status === "approved") {
    await sendMessage(botToken, chatId, "Ya tenés acceso, te van a llegar las ofertas por acá 👍");
  } else {
    await sendMessage(botToken, chatId, "Tu acceso está desactivado. Si es un error, avisale al dueño del bot.");
  }
}

const ACTION_TO_STATUS: Record<string, "approved" | "revoked"> = {
  approve: "approved",
  reject: "revoked",
  revoke: "revoked",
  unrevoke: "approved",
};

async function handleCallback(supabase: SupabaseClient, botToken: string, callback: TelegramCallbackQuery): Promise<void> {
  // Los botones de las alertas los puede tocar cualquiera que recibe ofertas,
  // no solo el dueño.
  if (String(callback.data ?? "").startsWith("deal:")) {
    await handleDealReaction(supabase, botToken, callback);
    return;
  }

  const ownerChatId = await getOwnerChatId(supabase);
  if (String(callback.from.id) !== ownerChatId) {
    await answerCallback(botToken, callback.id, "No autorizado.");
    return;
  }

  const [action, targetChatId] = String(callback.data ?? "").split(":");
  const newStatus = action ? ACTION_TO_STATUS[action] : undefined;
  if (!newStatus || !targetChatId) {
    await answerCallback(botToken, callback.id);
    return;
  }

  const { data: row } = await supabase
    .from("telegram_recipients")
    .update({ status: newStatus, decided_at: new Date().toISOString() })
    .eq("chat_id", targetChatId)
    .select("name, username")
    .maybeSingle();

  const approved = newStatus === "approved";
  const label = row?.name ? `${row.name}${row.username ? ` (${row.username})` : ""}` : targetChatId;

  const messageId = callback.message?.message_id;
  if (messageId && ownerChatId) {
    await editMessage(
      botToken,
      ownerChatId,
      messageId,
      `${approved ? "✅" : "🚫"} <b>${escapeHtml(label)}</b> ${approved ? "tiene acceso." : "sin acceso."}`,
      {
        inline_keyboard: [
          [
            approved
              ? { text: "🚫 Quitar acceso", callback_data: `revoke:${targetChatId}` }
              : { text: "✅ Volver a dar acceso", callback_data: `unrevoke:${targetChatId}` },
          ],
        ],
      },
    ).catch((err) => console.error("No se pudo editar el mensaje de aprobación:", err));
  }

  await answerCallback(botToken, callback.id, approved ? "Aprobado" : "Acceso quitado");

  await sendMessage(
    botToken,
    targetChatId,
    approved ? "✅ ¡Listo! Ya vas a recibir las ofertas por acá." : "Se desactivó tu acceso a los avisos de ofertas.",
  ).catch(() => {}); // Si la persona bloqueó el bot, no hay nada que hacerle acá.
}

/**
 * "🛒 La compro" / "👎 Paso" en una alerta. Guarda la reacción (tocar el mismo
 * botón otra vez la borra) y edita la alerta en el chat de todos los que la
 * recibieron, para que se vea quién la está comprando. Solo uno puede estar
 * comprando cada publicación: si otro ya la marcó, se avisa y no se pisa.
 */
async function handleDealReaction(
  supabase: SupabaseClient,
  botToken: string,
  callback: TelegramCallbackQuery,
): Promise<void> {
  const [, action, ...rest] = String(callback.data).split(":");
  const itemId = rest.join(":");
  const reaction = action === "buy" || action === "skip" ? (action as DealReaction) : null;
  const chatId = String(callback.from.id);
  if (!reaction || !itemId) {
    await answerCallback(botToken, callback.id);
    return;
  }

  const { data: recipient } = await supabase
    .from("telegram_recipients")
    .select("status, name, is_owner")
    .eq("chat_id", chatId)
    .maybeSingle();
  if (recipient?.status !== "approved") {
    await answerCallback(botToken, callback.id, "Tu acceso a las ofertas no está activo.");
    return;
  }
  // El nombre de Telegram de la persona; el dueño se sembró como "Dueño".
  const name =
    [callback.from.first_name, callback.from.last_name].filter(Boolean).join(" ") || recipient.name || "Alguien";

  const { data: current } = await supabase.from("deal_reactions").select("chat_id, name, reaction").eq("item_id", itemId);
  const reactions = (current ?? []) as ReactionRow[];
  const mine = reactions.find((r) => r.chat_id === chatId);
  const buyer = reactions.find((r) => r.reaction === "buy");

  let notice: string;
  if (mine?.reaction === reaction) {
    // Mismo botón otra vez: deshacer.
    await supabase.from("deal_reactions").delete().eq("item_id", itemId).eq("chat_id", chatId);
    notice = reaction === "buy" ? "Listo, ya no figura que la comprás." : "Quitado.";
  } else if (reaction === "buy" && buyer && buyer.chat_id !== chatId) {
    await answerCallback(botToken, callback.id, `Ya la está comprando ${buyer.name ?? "otra persona"}.`);
    return;
  } else {
    const { error } = await supabase
      .from("deal_reactions")
      .upsert({ item_id: itemId, chat_id: chatId, name, reaction, reacted_at: new Date().toISOString() }, { onConflict: "item_id,chat_id" });
    if (error) {
      // El índice único de comprador: otro la marcó en el mismo instante.
      await answerCallback(botToken, callback.id, "Otra persona la acaba de marcar. Mirá el mensaje.");
      return;
    }
    notice = reaction === "buy" ? "🛒 Marcado: la estás comprando. Les avisé a los demás." : "👎 Marcado: pasás de esta.";
  }

  await answerCallback(botToken, callback.id, notice);
  await refreshAlertMessages(supabase, botToken, itemId);
}

/** Vuelve a dibujar la alerta en el chat de todos, con el pie de quién reaccionó. */
async function refreshAlertMessages(supabase: SupabaseClient, botToken: string, itemId: string): Promise<void> {
  const [{ data: messages }, { data: reactions }] = await Promise.all([
    supabase.from("telegram_alert_messages").select("chat_id, message_id, text").eq("item_id", itemId),
    supabase.from("deal_reactions").select("chat_id, name, reaction").eq("item_id", itemId).order("reacted_at"),
  ]);
  const footer = reactionFooter((reactions ?? []) as ReactionRow[]);
  await Promise.allSettled(
    (messages ?? []).map((m) =>
      editMessage(botToken, m.chat_id, Number(m.message_id), `${m.text}${footer}`, dealKeyboard(itemId)).catch((err) =>
        // "message is not modified" o un chat que bloqueó el bot: no hay nada que hacer.
        console.error(`No se pudo editar la alerta ${itemId} en ${m.chat_id}:`, err),
      )
    ),
  );
}

/** Panel de control: un botón de acción por cada persona que alguna vez pidió acceso. */
async function sendRecipientsPanel(supabase: SupabaseClient, botToken: string, ownerChatId: string): Promise<void> {
  const { data } = await supabase
    .from("telegram_recipients")
    .select("chat_id, name, username, status, is_owner")
    .order("requested_at", { ascending: true });

  const rows = (data ?? []).filter((r) => !r.is_owner);
  if (rows.length === 0) {
    await sendMessage(botToken, ownerChatId, "Todavía nadie más pidió acceso al bot.");
    return;
  }

  const keyboard = rows.map((r) => {
    const label = `${(r.name ?? r.chat_id).slice(0, 28)}${r.username ? ` ${r.username}` : ""}`;
    if (r.status === "pending") {
      return [
        { text: `⏳ ${label} · Aprobar`, callback_data: `approve:${r.chat_id}` },
        { text: "🚫", callback_data: `reject:${r.chat_id}` },
      ];
    }
    if (r.status === "approved") {
      return [{ text: `✅ ${label} · Quitar acceso`, callback_data: `revoke:${r.chat_id}` }];
    }
    return [{ text: `🚫 ${label} · Dar acceso`, callback_data: `unrevoke:${r.chat_id}` }];
  });

  await sendMessage(botToken, ownerChatId, "<b>Gente que pidió acceso al bot</b>", { inline_keyboard: keyboard });
}

async function sendMessage(botToken: string, chatId: string, text: string, replyMarkup?: InlineKeyboard): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", reply_markup: replyMarkup }),
  });
  if (!res.ok) throw new Error(`sendMessage ${res.status}: ${await res.text()}`);
}

async function editMessage(
  botToken: string,
  chatId: string,
  messageId: number,
  text: string,
  replyMarkup: InlineKeyboard,
): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: "HTML", reply_markup: replyMarkup }),
  });
  if (!res.ok) throw new Error(`editMessageText ${res.status}: ${await res.text()}`);
}

async function answerCallback(botToken: string, callbackQueryId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch(() => {}); // Cosmético (saca el spinner del botón): que falle esto no puede tumbar el resto.
}

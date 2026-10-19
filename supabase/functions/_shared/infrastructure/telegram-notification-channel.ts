import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { EvaluatedDeal, NotificationChannel } from "../domain/types.ts";
import { needsBatteryGradeReview } from "../domain/hardware-signals.ts";
import { getApprovedChatIds } from "./telegram-recipients.ts";
import { dealKeyboard, recordAlertMessages } from "./telegram-deal-reactions.ts";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatMessage(deal: EvaluatedDeal): string {
  // Una subasta nunca se anuncia como ofertaza: el precio final es desconocido.
  // Y cuando se avisa es porque está por cerrar, así que eso encabeza.
  // El tipo especial le gana a "ofertaza" en compra directa: es la categoría
  // que se está buscando a propósito, no solo un buen puntaje. En subasta
  // sigue mandando el cierre, con la marca del tipo al lado.
  // Una Dell 2 en 1 que igual llegó al aviso (por puntaje) no se anuncia como
  // oferta especial: es una oferta normal.
  const special =
    deal.specialLabel && !deal.specialDemoted
      ? `🔄 <b>OFERTA ${escapeHtml(deal.specialLabel.toUpperCase())}</b>`
      : null;
  // OFERTA URGENTE le gana a todo lo demás: es la combinación que se compra
  // sin pensarlo. Si además es 2 en 1, se dice al lado.
  const header = deal.isUrgent
    ? `💰 <b>OFERTA URGENTE</b> 💰${special ? ` · ${special}` : ""}`
    : deal.isAuction
    ? `⏰ <b>Subasta por cerrar</b>${special ? ` · ${special}` : ""}`
    : special
      ? special
      : deal.isGreatDeal
        ? "🚨 <b>OFERTAZA</b>"
        : deal.isPriority
          ? "⭐ <b>CPU prioritaria</b>"
          : "🔥 <b>Oferta encontrada</b>";
  const auctionTag = deal.isAuction ? ` · ${timeLeft(deal.endDate)}` : "";
  const missing: string[] = [];
  if (!deal.hasDescription) missing.push("sin descripción");
  if (!deal.hasBatteryInfo) missing.push("sin dato de batería");
  if (needsBatteryGradeReview(deal.batteryGrade)) missing.push(`batería grado ${deal.batteryGrade}`);

  const lines = [
    `${header} — ${deal.cpuMatch} (puntaje ${deal.score ?? "?"}/100)${auctionTag}`,
    ``,
    `<b>${escapeHtml(deal.title)}</b>`,
    `💵 ${deal.price ?? "?"} ${deal.currency}${deal.isAuction ? " (precio actual, no final)" : ""}${deal.condition ? ` · ${escapeHtml(deal.condition)}` : ""}`,
  ];


  if (missing.length > 0) {
    lines.push(`⚠️ ${missing.join(" · ")} — revisar la publicación antes de comprar`);
  }
  // Grieta o golpe que no descarta: lo que dijo el vendedor, para mirar las fotos.
  if (deal.cosmeticNote) {
    lines.push(`🔍 Revisar fotos — el vendedor dice: «${escapeHtml(deal.cosmeticNote)}»`);
  }

  lines.push(``, deal.url);
  return lines.join("\n");
}

const DIGEST_MAX_ITEMS = 12;

/** Cuánto falta para el cierre, para que se pueda decidir sin abrir el link. */
function timeLeft(endDate: string | null): string {
  if (!endDate) return "cierre desconocido";
  const minutes = Math.floor((new Date(endDate).getTime() - Date.now()) / 60_000);
  if (minutes <= 0) return "cerrada";
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `cierra en ${minutes} min`;
  return `cierra en ${hours}h ${minutes % 60}m`;
}

/**
 * Cada línea del resumen tiene que poder accionarse sola: precio, equipo y un
 * link directo a la publicación. Un listado de precios sueltos sin título ni
 * link no sirve para decidir nada.
 */
function formatDigest(deals: EvaluatedDeal[]): string {
  const shown = deals.slice(0, DIGEST_MAX_ITEMS);
  const lines = [`📋 <b>${deals.length} oferta(s) más</b> en esta pasada`, ``];

  for (const deal of shown) {
    const title = deal.title.length > 58 ? `${deal.title.slice(0, 57)}…` : deal.title;
    const tags = [
      deal.isUrgent ? "💰 URGENTE" : null,
      deal.specialLabel && !deal.specialDemoted ? `🔄 ${deal.specialLabel}` : null,
      deal.cpuMatch,
      deal.isAuction ? "subasta" : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(
      `<b>$${deal.price ?? "?"}</b> · ${tags} · ${deal.score ?? "?"}/100`,
      `<a href="${deal.url}">${escapeHtml(title)}</a>`,
      ``,
    );
  }

  if (deals.length > shown.length) {
    lines.push(`…y ${deals.length - shown.length} más en el dashboard`);
  }

  return lines.join("\n");
}

/** Canal de notificación por Telegram. Implementá otro NotificationChannel (push, WhatsApp) sin tocar esto. */
export class TelegramNotificationChannel implements NotificationChannel {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * La alerta va con los botones "🛒 La compro" / "👎 Paso", y se guarda qué
   * mensaje le llegó a cada uno: cuando alguien toca un botón, telegram-webhook
   * edita la alerta en el chat de todos.
   */
  async notify(deal: EvaluatedDeal): Promise<void> {
    const text = formatMessage(deal);
    const sent = await this.send(text, false, dealKeyboard(deal.itemId));
    await recordAlertMessages(this.supabase, deal.itemId, text, sent);
  }

  async notifyDigest(deals: EvaluatedDeal[]): Promise<void> {
    await this.send(formatDigest(deals), true);
  }

  /**
   * Los destinatarios salen de telegram_recipients (aprobados vía el bot,
   * ver telegram-webhook), no de una lista fija en la secret. Cada
   * destinatario es independiente: si a alguien le rebota (bloqueó el bot,
   * chat borrado), eso no le impide recibir el aviso al resto ni hace que se
   * reintente y les llegue duplicado en la próxima corrida. Solo se lanza si
   * a NINGÚN destinatario le llegó, que es el caso real de "esto no se avisó".
   */
  private async send(
    text: string,
    disablePreview: boolean,
    replyMarkup?: ReturnType<typeof dealKeyboard>,
  ): Promise<{ chatId: string; messageId: number }[]> {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatIds = await getApprovedChatIds(this.supabase);

    if (!token || chatIds.length === 0) {
      console.warn("TELEGRAM_BOT_TOKEN sin configurar o ningún destinatario aprobado, se omite notificación.");
      return [];
    }

    const results = await Promise.allSettled(
      chatIds.map((chatId) => this.sendTo(token, chatId, text, disablePreview, replyMarkup)),
    );

    const failures = results
      .map((r, i) => ({ r, chatId: chatIds[i] }))
      .filter((x): x is { r: PromiseRejectedResult; chatId: string } => x.r.status === "rejected");
    for (const { r, chatId } of failures) {
      console.error(`Telegram: no le llegó a ${chatId}:`, r.reason);
    }

    if (failures.length === results.length) {
      throw new Error(`Telegram sendMessage falló para los ${results.length} destinatario(s).`);
    }

    return results
      .map((r, i) => (r.status === "fulfilled" ? { chatId: chatIds[i], messageId: r.value } : null))
      .filter((x): x is { chatId: string; messageId: number } => x !== null);
  }

  /** Devuelve el id del mensaje enviado, para poder editarlo después. */
  private async sendTo(
    token: string,
    chatId: string,
    text: string,
    disablePreview: boolean,
    replyMarkup?: ReturnType<typeof dealKeyboard>,
  ): Promise<number> {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: disablePreview,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { result?: { message_id?: number } };
    return json.result?.message_id ?? 0;
  }
}

import type { EvaluatedDeal, NotificationChannel } from "../domain/types.ts";
import { needsBatteryGradeReview } from "../domain/hardware-signals.ts";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatMessage(deal: EvaluatedDeal): string {
  // Una subasta nunca se anuncia como ofertaza: el precio final es desconocido.
  // Y cuando se avisa es porque está por cerrar, así que eso encabeza.
  const header = deal.isAuction
    ? "⏰ <b>Subasta por cerrar</b>"
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
    const tags = [deal.cpuMatch, deal.isAuction ? "subasta" : null].filter(Boolean).join(" · ");
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
  notify(deal: EvaluatedDeal): Promise<void> {
    return this.send(formatMessage(deal), false);
  }

  notifyDigest(deals: EvaluatedDeal[]): Promise<void> {
    return this.send(formatDigest(deals), true);
  }

  private async send(text: string, disablePreview: boolean): Promise<void> {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const chatId = Deno.env.get("TELEGRAM_CHAT_ID");
    if (!token || !chatId) {
      console.warn("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID no configurados, se omite notificación.");
      return;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: disablePreview,
      }),
    });

    if (!res.ok) {
      console.error(`Telegram sendMessage error ${res.status}: ${await res.text()}`);
    }
  }
}

import type { EvaluatedDeal, NotificationChannel } from "../domain/types.ts";
import { needsBatteryGradeReview } from "../domain/hardware-signals.ts";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatMessage(deal: EvaluatedDeal): string {
  const header = deal.isGreatDeal ? "🚨 <b>OFERTAZA</b>" : "🔥 <b>Oferta encontrada</b>";
  const auctionTag = deal.isAuction ? " 🔨 Subasta" : "";
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

/** Canal de notificación por Telegram. Implementá otro NotificationChannel (push, WhatsApp) sin tocar esto. */
export class TelegramNotificationChannel implements NotificationChannel {
  notify(deal: EvaluatedDeal): Promise<void> {
    return this.send(formatMessage(deal), false);
  }

  notifySummary(text: string): Promise<void> {
    return this.send(text, true);
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

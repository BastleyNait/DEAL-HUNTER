import type { EvaluatedDeal, NotificationChannel } from "../domain/types.ts";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatMessage(deal: EvaluatedDeal): string {
  const header = deal.isGreatDeal ? "🚨 <b>OFERTAZA</b>" : "🔥 <b>Oferta encontrada</b>";
  return [
    `${header} — ${deal.cpuMatch} (puntaje ${deal.score ?? "?"}/100)`,
    ``,
    `<b>${escapeHtml(deal.title)}</b>`,
    `💵 ${deal.price ?? "?"} ${deal.currency}${deal.condition ? ` · ${escapeHtml(deal.condition)}` : ""}`,
    ``,
    deal.url,
  ].join("\n");
}

/** Canal de notificación por Telegram. Implementá otro NotificationChannel (push, WhatsApp) sin tocar esto. */
export class TelegramNotificationChannel implements NotificationChannel {
  async notify(deal: EvaluatedDeal): Promise<void> {
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
        text: formatMessage(deal),
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    });

    if (!res.ok) {
      console.error(`Telegram sendMessage error ${res.status}: ${await res.text()}`);
    }
  }
}

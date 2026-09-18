/**
 * Utilidad de uso manual: "¿quién le escribió al bot y todavía no le sumé el
 * chat_id?". Cada persona nueva manda cualquier mensaje al bot una vez, y
 * esto lee el chat_id desde la propia API de Telegram — nadie necesita ir a
 * buscarlo a mano con otro bot ni saber qué es un chat_id.
 *
 * Token propio (ADMIN_TOKEN) y no PUBLISH_TOKEN a propósito: PUBLISH_TOKEN
 * está horneado en el build del frontend (VITE_PUBLISH_TOKEN), o sea que
 * cualquiera que abra el dashboard público puede sacarlo del bundle. Esto
 * devuelve nombres y usuarios de Telegram de gente real — no puede colgar de
 * un secreto que ya es semipúblico. ADMIN_TOKEN nunca sale de acá: se usa
 * solo a mano, por curl o similar, nunca desde el navegador.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-token",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

interface TelegramUpdate {
  message?: {
    date: number;
    text?: string;
    chat: { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string };
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const adminToken = Deno.env.get("ADMIN_TOKEN");
  if (!adminToken || req.headers.get("x-admin-token") !== adminToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return Response.json({ error: "Falta TELEGRAM_BOT_TOKEN en las secrets." }, { status: 500, headers: CORS_HEADERS });
  }

  const res = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates?limit=100`);
  if (!res.ok) {
    return Response.json({ error: `Telegram getUpdates ${res.status}: ${await res.text()}` }, { status: 502, headers: CORS_HEADERS });
  }

  const json = (await res.json()) as { result: TelegramUpdate[] };

  // Una persona puede mandar varios mensajes; se queda solo con el más
  // reciente de cada chat_id para no repetir la misma persona varias veces.
  const byChatId = new Map<string, { chatId: string; name: string; username: string | null; lastMessage: string; at: string }>();
  for (const update of json.result) {
    const chat = update.message?.chat;
    if (!chat || chat.type !== "private") continue; // Grupos/canales no sirven acá: son avisos 1 a 1.
    const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || "(sin nombre)";
    byChatId.set(String(chat.id), {
      chatId: String(chat.id),
      name,
      username: chat.username ? `@${chat.username}` : null,
      lastMessage: update.message?.text ?? "",
      at: new Date((update.message?.date ?? 0) * 1000).toISOString(),
    });
  }

  return Response.json({ data: [...byChatId.values()] }, { headers: CORS_HEADERS });
});

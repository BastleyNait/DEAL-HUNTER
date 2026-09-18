/**
 * Utilidades de uso manual para administrar el bot de Telegram — nunca se
 * llama desde el frontend, solo a mano por curl. Dos acciones:
 *
 *  - register-webhook: le dice a Telegram que mande cada mensaje/botón
 *    tocado a telegram-webhook, en vez de que alguien tenga que ir a
 *    preguntarle (polling). Se corre una sola vez (o de nuevo si se
 *    redespliega el proyecto a otra URL).
 *  - status: consulta a Telegram qué webhook tiene configurado ahora mismo,
 *    útil para confirmar que quedó bien o ver el último error de entrega.
 *
 * Token propio (ADMIN_TOKEN) y no PUBLISH_TOKEN a propósito: PUBLISH_TOKEN
 * está horneado en el build del frontend, así que cualquiera que abra el
 * dashboard podría sacarlo del bundle. Esto configura el bot entero — no
 * puede depender de un secreto que ya es semipúblico.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const adminToken = Deno.env.get("ADMIN_TOKEN");
  if (!adminToken || req.headers.get("x-admin-token") !== adminToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return json({ error: "Falta TELEGRAM_BOT_TOKEN en las secrets." }, 500);

  let body: { action?: string } = {};
  try {
    body = await req.json();
  } catch {
    // Sin body también vale — status no necesita ninguno.
  }

  if (body.action === "status") {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getWebhookInfo`);
    return json(await res.json(), res.status);
  }

  if (body.action === "register-webhook") {
    const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!webhookSecret || !supabaseUrl) {
      return json({ error: "Faltan TELEGRAM_WEBHOOK_SECRET o SUPABASE_URL en las secrets." }, 500);
    }

    const webhookUrl = `${supabaseUrl}/functions/v1/telegram-webhook`;
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: webhookSecret,
        // Solo lo que el webhook realmente entiende — de más solo genera
        // updates que se descartan en silencio, pero mejor no pedirlos.
        allowed_updates: ["message", "callback_query"],
      }),
    });
    return json(await res.json(), res.status);
  }

  return json({ error: "action inválida: usá 'register-webhook' o 'status'." }, 400);
});

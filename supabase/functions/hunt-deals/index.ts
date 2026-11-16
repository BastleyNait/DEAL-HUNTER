import { createClient } from "npm:@supabase/supabase-js@2";
import { HuntService } from "../_shared/application/hunt-service.ts";
import { EbayTokenStore } from "../_shared/infrastructure/ebay-token-store.ts";
import { EbayMarketplaceClient } from "../_shared/infrastructure/ebay-marketplace-client.ts";
import { SupabaseConfigProvider } from "../_shared/infrastructure/supabase-config-provider.ts";
import { SupabaseDealRepository } from "../_shared/infrastructure/supabase-deal-repository.ts";
import { SupabaseRunTracker } from "../_shared/infrastructure/supabase-run-tracker.ts";
import { TelegramNotificationChannel, TelegramSimpleChannel } from "../_shared/infrastructure/telegram-notification-channel.ts";
import { createWeightedScoringStrategy } from "../_shared/scoring/weighted-scoring-strategy.ts";

// Bot de estaciones de trabajo: solo si están las dos secrets.
// TELEGRAM_WORKSTATION_CHAT_IDS: ids separados por coma.
function workstationChannel(): TelegramSimpleChannel | null {
  const token = Deno.env.get("TELEGRAM_WORKSTATION_BOT_TOKEN");
  const chatIds = (Deno.env.get("TELEGRAM_WORKSTATION_CHAT_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return token && chatIds.length > 0 ? new TelegramSimpleChannel(token, chatIds, "🖥️ <b>ESTACIÓN DE TRABAJO</b>") : null;
}

// Composition root: el único lugar que arma las implementaciones concretas
// (eBay, Supabase, Telegram) y las inyecta en HuntService. Si algún día se
// agrega otro marketplace o canal, se cablea acá — el resto del código no cambia.
Deno.serve(async (req) => {
  // Falla cerrado a propósito: si CRON_SECRET no está seteado (o quedó vacío
  // por error), la función rechaza todo en vez de quedar pública sin querer.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const runTracker = new SupabaseRunTracker(supabase);
  const runId = await runTracker.start();

  const huntService = new HuntService(
    new SupabaseConfigProvider(supabase),
    new EbayMarketplaceClient(new EbayTokenStore(supabase)),
    new SupabaseDealRepository(supabase),
    (config) => createWeightedScoringStrategy(config),
    new TelegramNotificationChannel(supabase),
    workstationChannel(),
  );

  try {
    // El id de corrida rota qué vetas de búsqueda se usan esta vez, así el pool
    // completo se recorre a lo largo del día sin gastar cuota de más por corrida.
    const stats = await huntService.run(Number(runId));
    await runTracker.finish(runId, stats);
    return Response.json({ ok: true, ...stats });
  } catch (err) {
    console.error(err);
    await runTracker.finish(runId, {
      itemsScanned: 0,
      candidatesChecked: 0,
      itemsQualified: 0,
      duplicatesSkipped: 0,
      error: String(err),
    });
    return new Response(String(err), { status: 500 });
  }
});

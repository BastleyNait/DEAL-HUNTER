import { createClient } from "npm:@supabase/supabase-js@2";
import { PublishService } from "../_shared/application/publish-service.ts";
import { EbayTokenStore } from "../_shared/infrastructure/ebay-token-store.ts";
import { EbayMarketplaceClient } from "../_shared/infrastructure/ebay-marketplace-client.ts";
import { SupabaseConfigProvider } from "../_shared/infrastructure/supabase-config-provider.ts";
import { SupabasePublicationRepository } from "../_shared/infrastructure/supabase-publication-repository.ts";
import { RevoltStorePublishTarget } from "../_shared/infrastructure/revolt-store-publish-target.ts";
import type { PublicationRepository, StorePublishTarget } from "../_shared/domain/types.ts";

// Se llama desde el navegador (el dashboard, sin login), a diferencia de
// hunt-deals que solo lo llama el cron. Por eso lleva CORS y un secreto propio
// (PUBLISH_TOKEN) en vez de CRON_SECRET: publicar es una acción que dispara
// una persona a propósito, no algo que corre solo.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-publish-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// resolve() nunca los llama (no toca la tienda ni escribe nada) — están acá
// solo para satisfacer el constructor de PublishService sin pedir las
// credenciales de REVOLT-LAP antes de tiempo. Si algo los llamara igual, que
// truene fuerte en vez de fallar en silencio.
const NULL_STORE_TARGET: StorePublishTarget = {
  publish() {
    throw new Error("StorePublishTarget no disponible en modo resolve.");
  },
};
const NULL_PUBLICATION_REPOSITORY: PublicationRepository = {
  findStatuses() {
    throw new Error("PublicationRepository no disponible en modo resolve.");
  },
  save() {
    throw new Error("PublicationRepository no disponible en modo resolve.");
  },
};

// Composition root: arma eBay + Supabase + REVOLT-LAP y los inyecta en
// PublishService. Un canal nuevo (Facebook vía el worker local, o cualquier
// otro) no toca este archivo salvo para cablear un StorePublishTarget más.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  const publishToken = Deno.env.get("PUBLISH_TOKEN");
  if (!publishToken || req.headers.get("x-publish-token") !== publishToken) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: { action?: string; [key: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body inválido, se espera JSON." }, 400);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // resolve() solo lee de eBay: no necesita las credenciales de la tienda, así
  // que no se le exigen. Se piden recién para publish(), que es quien las usa.
  if (body.action === "resolve") {
    const service = new PublishService(
      new SupabaseConfigProvider(supabase),
      new EbayMarketplaceClient(new EbayTokenStore(supabase)),
      NULL_STORE_TARGET,
      NULL_PUBLICATION_REPOSITORY,
    );
    try {
      return json({ data: await service.resolve(String(body.url ?? "")) });
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  const storeBaseUrl = Deno.env.get("REVOLT_STORE_BASE_URL");
  const storeAdminPassword = Deno.env.get("REVOLT_STORE_ADMIN_PASSWORD");
  if (!storeBaseUrl || !storeAdminPassword) {
    return json({ error: "Faltan REVOLT_STORE_BASE_URL / REVOLT_STORE_ADMIN_PASSWORD en las secrets." }, 500);
  }

  const service = new PublishService(
    new SupabaseConfigProvider(supabase),
    new EbayMarketplaceClient(new EbayTokenStore(supabase)),
    new RevoltStorePublishTarget(storeBaseUrl, storeAdminPassword),
    new SupabasePublicationRepository(supabase),
  );

  try {
    if (body.action === "publish") {
      const result = await service.publish({
        itemId: String(body.itemId ?? ""),
        title: String(body.title ?? ""),
        description: String(body.description ?? ""),
        priceUsd: Number(body.priceUsd),
        imageUrls: Array.isArray(body.imageUrls) ? body.imageUrls.map(String) : [],
        queueForFacebook: Boolean(body.queueForFacebook),
      });
      return json({ data: result });
    }

    return json({ error: "action inválida: usá 'resolve' o 'publish'." }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

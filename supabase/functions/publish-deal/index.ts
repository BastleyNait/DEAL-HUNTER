import { createClient } from "npm:@supabase/supabase-js@2";
import { PublishService } from "../_shared/application/publish-service.ts";
import { EbayTokenStore } from "../_shared/infrastructure/ebay-token-store.ts";
import { EbayMarketplaceClient } from "../_shared/infrastructure/ebay-marketplace-client.ts";
import { SupabaseConfigProvider } from "../_shared/infrastructure/supabase-config-provider.ts";
import { SupabasePublicationRepository } from "../_shared/infrastructure/supabase-publication-repository.ts";
import { RevoltStorePublishTarget } from "../_shared/infrastructure/revolt-store-publish-target.ts";
import type { PublicationRepository, StorePublishTarget } from "../_shared/domain/types.ts";
import { legacyIdFromUrl, recordPurchase } from "../_shared/infrastructure/purchases.ts";
import { marketplaceTitle, storeDescriptionToText } from "../_shared/domain/marketplace-text.ts";

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
  queueForFacebook() {
    throw new Error("PublicationRepository no disponible en modo resolve.");
  },
};

/**
 * El publicador manda su propia key (la de su .env), que puede no ser
 * idéntica a la que ve esta función (key legacy vs. nueva del mismo
 * proyecto). En vez de comparar strings, se la usa: publications no tiene
 * policies para anon, así que solo una service role válida de este proyecto
 * puede leer esa fila.
 */
async function canReadPublication(req: Request, itemId: unknown): Promise<boolean> {
  const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!key || typeof itemId !== "string" || !itemId) return false;
  const { data, error } = await createClient(Deno.env.get("SUPABASE_URL")!, key, {
    auth: { persistSession: false },
  })
    .from("publications")
    .select("item_id")
    .eq("item_id", itemId)
    .maybeSingle();
  return !error && !!data;
}

// Composition root: arma eBay + Supabase + REVOLT-LAP y los inyecta en
// PublishService. Un canal nuevo (Facebook vía el worker local, o cualquier
// otro) no toca este archivo salvo para cablear un StorePublishTarget más.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  let body: { action?: string; [key: string]: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body inválido, se espera JSON." }, 400);
  }

  // El dashboard se identifica con PUBLISH_TOKEN. El publicador de Facebook
  // (tu PC) ya tiene una service role para leer la cola, así que con esa
  // misma puede pedir el texto fresco de la tienda — y solo eso.
  const publishToken = Deno.env.get("PUBLISH_TOKEN");
  const fromDashboard = !!publishToken && req.headers.get("x-publish-token") === publishToken;
  if (!fromDashboard && !(body.action === "facebook-sync" && (await canReadPublication(req, body.itemId)))) {
    return json({ error: "Unauthorized" }, 401);
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

  // Cola de "compradas por publicar" (tabla purchases). Agregar y quitar solo
  // tocan la tabla; el borrador sí lee eBay, pero de a un ítem y solo la
  // primera vez: después sale del caché (purchases.draft).
  if (body.action === "purchase-add") {
    try {
      const url = String(body.url ?? "");
      const legacyId = legacyIdFromUrl(url);
      if (!legacyId) return json({ error: "No es un link de eBay con /itm/<número>." }, 400);
      await recordPurchase(supabase, { itemId: `v1|${legacyId}|0`, url, source: "manual" });
      return json({ data: { legacyId } });
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  if (body.action === "purchase-dismiss") {
    const { error } = await supabase
      .from("purchases")
      .update({ dismissed_at: new Date().toISOString() })
      .eq("legacy_id", String(body.legacyId ?? ""));
    return error ? json({ error: error.message }, 500) : json({ data: { ok: true } });
  }

  if (body.action === "purchase-draft") {
    try {
      const legacyId = String(body.legacyId ?? "");
      const { data: purchase, error } = await supabase
        .from("purchases")
        .select("url, draft")
        .eq("legacy_id", legacyId)
        .maybeSingle();
      if (error || !purchase) return json({ error: "Esa compra no está en la cola." }, 404);
      if (purchase.draft && !body.refresh) return json({ data: purchase.draft, cached: true });

      const service = new PublishService(
        new SupabaseConfigProvider(supabase),
        new EbayMarketplaceClient(new EbayTokenStore(supabase)),
        NULL_STORE_TARGET,
        NULL_PUBLICATION_REPOSITORY,
      );
      const draft = await service.resolve(purchase.url);
      await supabase
        .from("purchases")
        .update({ draft, draft_at: new Date().toISOString(), item_id: draft.itemId })
        .eq("legacy_id", legacyId);
      return json({ data: draft, cached: false });
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  }

  // Encolar para Facebook solo toca la tabla publications: no necesita
  // eBay ni las credenciales de la tienda, así que tampoco se las exige.
  if (body.action === "facebook-queue") {
    try {
      const ids = Array.isArray(body.itemIds) ? body.itemIds.map(String) : undefined;
      const queued = await new SupabasePublicationRepository(supabase).queueForFacebook(ids);
      return json({ data: { queued } });
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

  // Justo antes de postear en Facebook, el publicador pide el producto tal
  // como quedó en REVOLT-LAP: lo que se corrigió en /admin (título, texto,
  // precio, orden de fotos) es lo que sale en Marketplace, no el borrador
  // que se mandó la primera vez. Se guarda también en publications, así la
  // cola del dashboard muestra el título vigente.
  if (body.action === "facebook-sync") {
    try {
      const itemId = String(body.itemId ?? "");
      const { data: row, error } = await supabase
        .from("publications")
        .select("store_product_id")
        .eq("item_id", itemId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) return json({ error: "Esa publicación no existe." }, 404);
      // Publicaciones viejas sin producto en la tienda: se postean como están.
      if (!row.store_product_id) return json({ data: null });

      const product = await new RevoltStorePublishTarget(storeBaseUrl, storeAdminPassword).fetchProduct(
        row.store_product_id,
      );
      if (!product) {
        return json({ error: "El producto ya no existe en revolt-laptops.com (¿lo borraste en /admin?)." }, 404);
      }

      // Un campo vacío en la tienda no deja el aviso sin texto ni sin fotos:
      // ahí se queda lo que ya estaba.
      const fresh: Record<string, unknown> = { title: marketplaceTitle(product.name), store_slug: product.slug };
      const description = storeDescriptionToText(product.description);
      if (description) fresh.description = description;
      if (product.images?.length) fresh.image_urls = product.images;
      // Facebook cobra en soles; si en la tienda quedó en otra moneda se
      // respeta el precio en soles que ya estaba.
      if (product.currency === "PEN" && Number(product.price) > 0) fresh.price_pen = Number(product.price);

      const { error: saveError } = await supabase.from("publications").update(fresh).eq("item_id", itemId);
      if (saveError) throw new Error(saveError.message);

      return json({
        data: {
          title: fresh.title,
          description: fresh.description ?? null,
          imageUrls: fresh.image_urls ?? null,
          pricePen: fresh.price_pen ?? null,
        },
      });
    } catch (err) {
      console.error(err);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
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

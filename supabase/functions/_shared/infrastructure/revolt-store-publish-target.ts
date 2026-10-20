import type { PublishDraft, StorePublishResult, StorePublishTarget } from "../domain/types.ts";

/** Lo que devuelve GET /api/products/:id de REVOLT-LAP (solo los campos que usamos). */
export interface StoreProduct {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  images: string[];
}

/**
 * Adaptador HTTP contra la API admin de REVOLT-LAP (Next.js + Supabase, repo
 * aparte). No hay nada que tocar de ese lado: /api/upload y /api/products ya
 * existen y aceptan justo esto. Baja las fotos de eBay, las resube a R2 (las
 * de eBay desaparecen cuando el listing termina) y crea el producto como
 * borrador (isActive: false) para que se revise antes de que aparezca en la
 * tienda.
 */
export class RevoltStorePublishTarget implements StorePublishTarget {
  constructor(
    private readonly baseUrl: string,
    private readonly adminPassword: string,
  ) {}

  async publish(draft: PublishDraft): Promise<StorePublishResult> {
    const uploadedImages = await this.reuploadImages(draft.imageUrls, draft.itemId);
    if (uploadedImages.length === 0) {
      throw new Error("No se pudo resubir ninguna foto a R2; no se crea el producto sin fotos.");
    }

    const slug = await this.uniqueSlug(draft.title, draft.itemId);

    const body = {
      name: draft.title,
      slug,
      brand: draft.brand || "Otro",
      price: draft.pricePen,
      originalPrice: null,
      currency: "PEN",
      conditionGrade: draft.conditionGrade,
      processor: draft.processor,
      ram: draft.ram,
      storage: draft.storage,
      display: draft.display,
      batteryHealth: draft.batteryHealth,
      description: draft.description,
      verdict: null,
      // La gráfica dedicada va como especificación "GPU": REVOLT-LAP la muestra
      // en la tarjeta del catálogo y como "Tarjeta gráfica" en la ficha.
      specs: draft.gpu ? [{ label: "GPU", value: draft.gpu }] : [],
      images: uploadedImages,
      // EN CAMINO: lo que se publica desde la Mesa de compra ya está comprado
      // pero todavía no llegó. La tienda lo muestra como "En camino · llega en
      // 10 a 15 días hábiles"; se desmarca en /admin cuando llega.
      badges: [draft.conditionGrade, "EN CAMINO"],
      stock: 1,
      // Borrador: lo activás vos desde /admin después de revisarlo.
      isActive: false,
      isFeatured: false,
    };

    const res = await fetch(`${this.baseUrl}/api/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-password": this.adminPassword },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`REVOLT-LAP /api/products error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { data: { id: string; slug: string } };
    return { productId: json.data.id, slug: json.data.slug };
  }

  /**
   * El producto tal como está hoy en la tienda, con lo que se haya editado en
   * /admin después de publicarlo (incluidos los borradores sin activar). null
   * si ya no existe.
   */
  async fetchProduct(productId: string): Promise<StoreProduct | null> {
    const res = await fetch(`${this.baseUrl}/api/products/${encodeURIComponent(productId)}`, {
      headers: { "x-admin-password": this.adminPassword },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`REVOLT-LAP /api/products/${productId} error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data: StoreProduct };
    return json.data;
  }

  /**
   * Descarga cada foto y la resube a R2 vía /api/upload. Una foto que falla se
   * salta (mejor un producto con 5 fotos que ninguno), pero se loguea para
   * poder revisarla a mano.
   */
  private async reuploadImages(urls: string[], itemId: string): Promise<string[]> {
    const formData = new FormData();
    let attached = 0;

    for (const [index, url] of urls.entries()) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get("content-type") ?? "image/jpeg";
        const ext = contentType.includes("png") ? "png" : "jpg";
        const blob = await res.blob();
        formData.append("images", blob, `${itemId.replace(/[^a-zA-Z0-9]/g, "")}-${index}.${ext}`);
        attached++;
      } catch (err) {
        console.error(`No se pudo descargar la foto ${index} (${url}):`, err);
      }
    }

    if (attached === 0) return [];

    const res = await fetch(`${this.baseUrl}/api/upload`, {
      method: "POST",
      headers: { "x-admin-password": this.adminPassword },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`REVOLT-LAP /api/upload error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { urls: string[] };
    return json.urls;
  }

  /**
   * REVOLT-LAP exige slug único (constraint en products.slug). El sufijo del
   * itemId lo garantiza sin tener que leer el catálogo primero: dos
   * publicaciones del mismo modelo nunca chocan.
   */
  private async uniqueSlug(title: string, itemId: string): Promise<string> {
    const base = title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    const suffix = itemId.replace(/[^0-9]/g, "").slice(-8);
    return `${base}-${suffix}`;
  }
}

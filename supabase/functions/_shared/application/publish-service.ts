import type {
  ConfigProvider,
  MarketplaceClient,
  PublicationRepository,
  PublishDraft,
  ResolvedListing,
  StorePublishResult,
  StorePublishTarget,
} from "../domain/types.ts";
import { createCpuMatcher } from "../cpu/cpu-matcher.ts";
import { parseEbayItemId } from "../domain/ebay-url.ts";
import {
  brandFromTitle,
  ruleBasedMarketingCopy,
  simplifyCpu,
  storeConditionGrade,
  type MarketingCopyGenerator,
} from "../domain/marketing-copy.ts";
import { computeSalePriceUsd } from "../domain/pricing.ts";
import { extractBatteryPercent, extractRamGb, extractStorageGb } from "../domain/hardware-signals.ts";
import { detectDedicatedGpu } from "../domain/dedicated-gpu.ts";

/**
 * Orquesta "de un link de eBay a una publicación en la tienda", en dos pasos
 * separados a propósito: resolve() solo lee de eBay y no escribe nada, así el
 * usuario puede ver y corregir el borrador antes de publish(), que sí
 * persiste. Mismo patrón de composición por puertos que HuntService.
 */
export class PublishService {
  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly marketplace: MarketplaceClient,
    private readonly storeTarget: StorePublishTarget,
    private readonly publications: PublicationRepository,
    private readonly copyGenerator: MarketingCopyGenerator = ruleBasedMarketingCopy,
  ) {}

  async resolve(urlOrId: string): Promise<ResolvedListing> {
    const itemId = parseEbayItemId(urlOrId);
    if (!itemId) {
      throw new Error("No se reconoce ese link de eBay. Pegá la URL completa de la publicación (ebay.com/itm/...).");
    }

    const config = await this.configProvider.getConfig();
    const detail = await this.marketplace.getDetail(itemId);
    const cpuMatcher = createCpuMatcher(config);
    const cpu = cpuMatcher.match(detail.title) ?? cpuMatcher.match(`${detail.title} ${detail.descriptionText}`);

    const copy = this.copyGenerator.generate({
      title: detail.title,
      descriptionText: detail.descriptionText,
      condition: detail.condition,
      aspects: detail.aspects,
      cpuLabel: cpu?.label ?? null,
      modelTiers: config.modelTiers,
    });

    const suggestedPrice =
      detail.price != null
        ? computeSalePriceUsd(detail.price, config.publishMarkupFlatUsd, config.publishMarkupMultiplier)
        : null;

    return {
      itemId,
      url: detail.url,
      title: detail.title,
      suggestedTitle: copy.title,
      suggestedDescription: copy.description,
      priceUsd: suggestedPrice,
      condition: detail.condition,
      images: [detail.imageUrl, ...detail.additionalImages].filter((u): u is string => Boolean(u)),
      cpuMatch: cpu?.label ?? null,
    };
  }

  /**
   * Publica lo que el usuario confirmó (título/descripción/precio/fotos
   * pueden venir editados). Vuelve a pedirle el detalle a eBay para los
   * campos estructurados (procesador, RAM, etc.) y como chequeo de que el
   * item sigue siendo real — no confía en nada que no sea el itemId.
   */
  async publish(input: {
    itemId: string;
    title: string;
    description: string;
    priceUsd: number;
    imageUrls: string[];
    queueForFacebook: boolean;
  }): Promise<StorePublishResult> {
    if (input.imageUrls.length === 0) throw new Error("Elegí al menos una foto para publicar.");
    if (!(input.priceUsd > 0)) throw new Error("El precio tiene que ser mayor a 0.");

    const config = await this.configProvider.getConfig();
    const detail = await this.marketplace.getDetail(input.itemId);
    const cpuMatcher = createCpuMatcher(config);
    const cpu = cpuMatcher.match(detail.title) ?? cpuMatcher.match(`${detail.title} ${detail.descriptionText}`);
    const text = `${detail.title} ${detail.descriptionText}`;

    const ram = extractRamGb(text);
    const storageGb = extractStorageGb(text);
    const battery = extractBatteryPercent(text);
    const screenAspect = detail.aspects.find((a) => /screen size/i.test(a.name));
    const gpu = detectDedicatedGpu(text, detail.aspects);

    const draft: PublishDraft = {
      itemId: input.itemId,
      ebayUrl: detail.url,
      title: input.title.trim(),
      description: input.description.trim(),
      priceUsd: input.priceUsd,
      pricePen: Math.round(input.priceUsd * config.publishUsdToPenRate),
      costUsd: detail.price ?? 0,
      currency: "PEN",
      imageUrls: input.imageUrls,
      brand: brandFromTitle(detail.title) || "Otro",
      conditionGrade: storeConditionGrade(detail.condition),
      processor: simplifyCpu(cpu?.label ?? null),
      ram: ram > 0 ? `${ram}GB` : null,
      storage: storageGb > 0 ? (storageGb >= 1000 ? `${Math.round(storageGb / 1000)}TB` : `${storageGb}GB`) : null,
      display: screenAspect?.value ?? null,
      batteryHealth: battery != null ? `${battery}%` : null,
      gpu: gpu ? `${gpu.name}${gpu.vramGb ? ` ${gpu.vramGb}GB` : ""}` : null,
    };

    const result = await this.storeTarget.publish(draft);

    await this.publications.save({
      itemId: draft.itemId,
      ebayUrl: draft.ebayUrl,
      title: draft.title,
      description: draft.description,
      priceUsd: draft.priceUsd,
      pricePen: draft.pricePen,
      costUsd: draft.costUsd,
      currency: draft.currency,
      imageUrls: draft.imageUrls,
      store: result,
      queueForFacebook: input.queueForFacebook,
    });

    return result;
  }
}

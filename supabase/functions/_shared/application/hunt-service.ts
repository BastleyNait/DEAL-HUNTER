import type {
  ConfigProvider,
  DealRepository,
  EvaluatedDeal,
  ListingDetail,
  ListingSummary,
  MarketplaceClient,
  NotificationChannel,
  RunStats,
  ScoringStrategy,
  SearchConfig,
  SearchProfile,
} from "../domain/types.ts";
import { createCpuMatcher, maxCpuTier } from "../cpu/cpu-matcher.ts";
import { createExclusionRules, evaluateExclusions } from "../rules/exclusion-rules.ts";
import {
  extractBatteryGrade,
  extractRamGb,
  hasMeaningfulDescription,
  listingFingerprint,
  mentionsBattery,
} from "../domain/hardware-signals.ts";

const PAGE_SIZE = 100;

interface Candidate {
  summary: ListingSummary;
  cpuLabel: string;
  cpuTier: number;
}

/**
 * Toma una ventana rotativa del pool de vetas: cada corrida usa un tramo
 * distinto (según el id de corrida), así se cubre todo el pool a lo largo del
 * día sin gastar una llamada por veta en cada corrida.
 */
export function selectProfiles(config: SearchConfig, rotationSeed: number): SearchProfile[] {
  const pool = config.searchProfiles;
  if (pool.length === 0) return [];
  const count = Math.min(config.profilesPerRun, pool.length);
  const start = ((rotationSeed % pool.length) + pool.length) % pool.length;
  return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
}

/**
 * Estimación barata de cuánto promete un candidato, con lo único que se sabe
 * antes de gastar una llamada de detalle: el título y el precio del listado.
 * Es un reflejo del scoring real (CPU prioritaria, 16GB, línea que se revende
 * bien, y el precio como desempate), no un criterio aparte.
 */
function promiseOf(candidate: Candidate, config: SearchConfig): number {
  const title = candidate.summary.title;
  let promise = candidate.cpuTier * 10;

  if (config.priorityCpus.includes(candidate.cpuLabel)) promise += 40;
  if (extractRamGb(title) >= 16) promise += 35;

  const modelTier = config.modelTiers.find((tier) => new RegExp(tier.pattern, tier.flags).test(title));
  promise += (modelTier ? modelTier.weight : config.modelFallbackWeight) * 30;

  // Desempate: entre dos candidatos parecidos, el más barato deja más margen.
  const price = candidate.summary.price;
  if (price != null) promise += Math.max(0, (config.maxPriceUsd - price) / config.maxPriceUsd) * 10;

  return promise;
}

/**
 * Orden en que vale la pena interrumpir: primero las CPUs prioritarias, y
 * dentro de cada grupo por puntaje.
 */
function betterFirst(a: EvaluatedDeal, b: EvaluatedDeal): number {
  if (a.isPriority !== b.isPriority) return a.isPriority ? -1 : 1;
  return (b.score ?? 0) - (a.score ?? 0);
}

/**
 * Orquesta una corrida completa: buscar en varias vetas -> matchear CPU ->
 * filtrar ya vistos -> pre-descartar con lo que ya tenemos -> traer detalle ->
 * aplicar reglas -> puntuar -> guardar -> notificar.
 * No sabe nada de eBay, Postgres ni Telegram: todo entra por las interfaces del
 * dominio (Dependency Inversion), así que se puede testear con fakes y se puede
 * extender (otro marketplace, otra regla, otro canal) sin tocar este archivo.
 */
export class HuntService {
  constructor(
    private readonly configProvider: ConfigProvider,
    private readonly marketplace: MarketplaceClient,
    private readonly dealRepository: DealRepository,
    private readonly buildScoringStrategy: (config: SearchConfig) => ScoringStrategy,
    private readonly notificationChannel: NotificationChannel,
  ) {}

  async run(rotationSeed = 0): Promise<RunStats> {
    const config = await this.configProvider.getConfig();
    const cpuMatcher = createCpuMatcher(config);
    const exclusionRules = createExclusionRules(config);
    const scoringStrategy = this.buildScoringStrategy(config);
    const maxTier = maxCpuTier(config);

    const stats: RunStats = { itemsScanned: 0, candidatesChecked: 0, itemsQualified: 0, duplicatesSkipped: 0 };

    // 1. Recorrer las vetas de esta corrida, deduplicando por id (las vetas se
    //    solapan entre sí a propósito).
    const candidates = new Map<string, Candidate>();
    for (const profile of selectProfiles(config, rotationSeed)) {
      for (let page = 0; page < profile.maxPages; page++) {
        // Una veta que falla (timeout, 5xx de eBay) no puede tumbar la corrida
        // entera: se registra y se sigue con las demás.
        let items: ListingSummary[];
        try {
          items = await this.marketplace.search(config, profile, { page, pageSize: PAGE_SIZE });
        } catch (err) {
          console.error(`Búsqueda fallida (${profile.query} / ${profile.sort} / p${page}):`, err);
          break;
        }
        if (items.length === 0) break;
        stats.itemsScanned += items.length;

        for (const item of items) {
          if (candidates.has(item.id)) continue;
          // El título alcanza en la mayoría de los casos, pero la
          // shortDescription (gratis con fieldgroups=EXTENDED) rescata los que
          // no ponen el modelo de CPU en el título.
          const cpu = cpuMatcher.match(item.title) ?? cpuMatcher.match(`${item.title} ${item.shortDescription}`);
          if (cpu) candidates.set(item.id, { summary: item, cpuLabel: cpu.label, cpuTier: cpu.tier });
        }

        if (items.length < PAGE_SIZE) break;
      }
    }

    // 2. Sacar los ya evaluados en corridas anteriores.
    const unseenIds = await this.dealRepository.filterUnseen([...candidates.keys()]);
    const unseen = unseenIds
      .map((id) => candidates.get(id)!)
      // Cuando hay más candidatos que presupuesto de llamadas de detalle, se
      // gastan en los más prometedores según lo que ya se sabe del título.
      // Antes se ordenaba por precio ascendente, que era coherente con el
      // scoring viejo ("más barato = mejor") pero contradice el actual: dejaba
      // el presupuesto en la punta barata y nunca llegaba a las máquinas que
      // realmente se compran.
      .sort((a, b) => promiseOf(b, config) - promiseOf(a, config));

    // 3. Colapsar republicaciones del mismo equipo (mismo título normalizado y
    //    precio), tanto dentro de esta corrida como contra lo ya guardado.
    //    Si la consulta falla se sigue sin ella: perder la corrida entera es
    //    peor que evaluar de más, y los avisos repetidos los corta después
    //    selectNotifiable().
    let knownFingerprints = new Set<string>();
    try {
      knownFingerprints = await this.dealRepository.findKnownFingerprints(
        unseen.map((c) => listingFingerprint(c.summary.title, c.summary.price)),
      );
    } catch (err) {
      console.error("Falló la consulta de huellas conocidas:", err);
    }
    const seenThisRun = new Set<string>();
    const fresh: Candidate[] = [];
    for (const candidate of unseen) {
      const fingerprint = listingFingerprint(candidate.summary.title, candidate.summary.price);
      if (knownFingerprints.has(fingerprint) || seenThisRun.has(fingerprint)) {
        stats.duplicatesSkipped++;
        // Se guarda como descartado para que no vuelva a evaluarse en cada corrida.
        const asListing: ListingDetail = {
          ...candidate.summary,
          descriptionText: candidate.summary.shortDescription,
          sellerDescription: "",
          sellerDescriptionHtml: "",
          aspects: [],
          additionalImages: [],
        };
        try {
          await this.dealRepository.save(
            this.toEvaluatedDeal(candidate, asListing, false, "duplicate_listing", null, false),
          );
        } catch (err) {
          // Un guardado que falla no puede tumbar la corrida, pero sí tiene que
          // verse en los logs: si falla siempre, ese ítem vuelve cada vez.
          console.error(`No se pudo guardar el duplicado ${candidate.summary.id}:`, err);
        }
        continue;
      }
      seenThisRun.add(fingerprint);
      fresh.push(candidate);
      if (fresh.length >= config.maxCandidatesPerRun) break;
    }

    const qualifiedDeals: EvaluatedDeal[] = [];

    for (const candidate of fresh) {
      try {
        // 3. Pre-descarte gratis: si con título + shortDescription ya sabemos que
        //    no sirve, lo guardamos como rechazado sin gastar la llamada de detalle.
        const preScreen: ListingDetail = {
          ...candidate.summary,
          descriptionText: candidate.summary.shortDescription,
          sellerDescription: "",
          sellerDescriptionHtml: "",
          aspects: [],
          additionalImages: [],
        };
        const preScreenResult = evaluateExclusions(exclusionRules, preScreen);
        if (!preScreenResult.qualifies) {
          await this.dealRepository.save(
            this.toEvaluatedDeal(candidate, preScreen, false, preScreenResult.reason, null, false),
          );
          continue;
        }

        stats.candidatesChecked++;
        const detail = await this.marketplace.getDetail(candidate.summary.id);
        const { qualifies, reason } = evaluateExclusions(exclusionRules, detail);

        let score: number | null = null;
        let isGreatDeal = false;
        if (qualifies && detail.price != null) {
          const result = scoringStrategy.score(detail, {
            maxPriceUsd: config.maxPriceUsd,
            cpuTier: candidate.cpuTier,
            maxCpuTier: maxTier,
          });
          score = result.score;
          isGreatDeal = result.isGreatDeal;
        }

        const evaluatedDeal = this.toEvaluatedDeal(
          candidate,
          detail,
          qualifies,
          reason,
          score,
          isGreatDeal,
          config.priorityCpus.includes(candidate.cpuLabel),
        );
        await this.dealRepository.save(evaluatedDeal);

        if (qualifies) {
          stats.itemsQualified++;
          qualifiedDeals.push(evaluatedDeal);
        }
      } catch (err) {
        // Un ítem que falla no descarta el resto de la corrida.
        console.error(`Falló la evaluación de ${candidate.summary.id}:`, err);
      }
    }

    // Las subastas no entran acá: tienen su propia pasada, que las avisa recién
    // cuando están por cerrar.
    await this.notifyQualified(config, qualifiedDeals.filter((d) => !d.isAuction));
    await this.notifyClosingAuctions(config);
    return stats;
  }

  /**
   * Saca de la lista lo que ya se avisó o lo que ya marcaste como visto en el
   * dashboard, mirando la máquina y no la publicación.
   *
   * Hace falta porque un vendedor que republica el mismo equipo genera un
   * item_id nuevo y, si además le cambia el precio, tampoco coincide la huella
   * de duplicados (que incluye el precio). Con eso solo, la misma ThinkPad
   * podía sonar en el teléfono tres veces.
   *
   * De paso colapsa los repetidos dentro de una misma corrida: si dos vetas
   * traen el mismo equipo, se avisa el mejor de los dos y nada más.
   */
  private async selectNotifiable(deals: EvaluatedDeal[]): Promise<EvaluatedDeal[]> {
    if (deals.length === 0) return [];

    let keys: Map<string, string>;
    try {
      keys = await this.dealRepository.findNotifiableKeys(deals.map((d) => d.itemId));
    } catch (err) {
      // Si el filtro falla se avisa igual: perderse una oferta es peor que
      // recibirla repetida.
      console.error("Falló el filtro de avisos ya vistos:", err);
      return deals;
    }

    const best = new Map<string, EvaluatedDeal>();
    for (const deal of deals) {
      const key = keys.get(deal.itemId);
      if (key === undefined) continue;
      const current = best.get(key);
      if (!current || betterFirst(deal, current) < 0) best.set(key, deal);
    }
    return [...best.values()];
  }

  /**
   * Avisa las subastas que recién ahora entran en su último tramo y dejan
   * margen para pujar. Va contra lo guardado, no contra lo encontrado en esta
   * corrida: una subasta descubierta con días de anticipación nunca se
   * re-evalúa, así que si dependiera del hallazgo no se avisaría jamás.
   */
  private async notifyClosingAuctions(config: SearchConfig): Promise<void> {
    let closing: EvaluatedDeal[];
    try {
      closing = await this.dealRepository.findAuctionsToAlert({
        maxPrice: config.auctionAlertMaxPrice,
        maxHoursLeft: config.auctionAlertMaxHoursLeft,
        limit: config.maxAuctionAlertsPerRun,
      });
    } catch (err) {
      console.error("Falló la búsqueda de subastas por cerrar:", err);
      return;
    }

    const notifiable = await this.selectNotifiable(closing);
    const notifiableIds = new Set(notifiable.map((d) => d.itemId));

    const sent: string[] = [];
    for (const deal of notifiable) {
      try {
        await this.notificationChannel.notify(deal);
        sent.push(deal.itemId);
      } catch (err) {
        console.error(`Falló el aviso de subasta ${deal.itemId}:`, err);
      }
    }

    // Las silenciadas también se marcan como avisadas: de esa máquina ya se
    // avisó, así que volver a traerlas en cada corrida es trabajo perdido.
    // Las que fallaron al enviarse no entran, y se reintentan la próxima vez.
    const silenced = closing.filter((d) => !notifiableIds.has(d.itemId)).map((d) => d.itemId);
    try {
      await this.dealRepository.markAuctionsAlerted([...silenced, ...sent]);
    } catch (err) {
      console.error("Falló el marcado de subastas avisadas:", err);
    }

    await this.markNotified(sent);
  }

  /**
   * Con el pool ampliado pueden salir decenas de ofertas por corrida. Se avisan
   * una por una solo las que valen interrumpir (ofertazas, las de mejor puntaje
   * primero) y el resto va en un solo mensaje de resumen; todas quedan igual en
   * el dashboard.
   */
  private async notifyQualified(config: SearchConfig, deals: EvaluatedDeal[]): Promise<void> {
    if (deals.length === 0) return;

    // El filtro va primero: no tiene sentido gastar el cupo de avisos de la
    // corrida en equipos que ya viste.
    const notifiable = await this.selectNotifiable(deals);
    if (notifiable.length === 0) return;

    // Las CPUs prioritarias avisan siempre, aunque no lleguen a ofertaza.
    const worthPinging = config.notifyOnlyGreatDeals
      ? notifiable.filter((d) => d.isGreatDeal || d.isPriority)
      : notifiable;

    const individual = [...worthPinging].sort(betterFirst).slice(0, config.maxNotificationsPerRun);
    const individualIds = new Set(individual.map((d) => d.itemId));

    const sent: string[] = [];
    for (const deal of individual) {
      try {
        await this.notificationChannel.notify(deal);
        sent.push(deal.itemId);
      } catch (err) {
        console.error(`Falló la notificación de ${deal.itemId}:`, err);
      }
    }

    const rest = notifiable.filter((d) => !individualIds.has(d.itemId));
    if (rest.length > 0) {
      try {
        await this.notificationChannel.notifyDigest(
          [...rest].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
        );
        // El resumen también cuenta como aviso: si aparece ahí, ya lo viste.
        sent.push(...rest.map((d) => d.itemId));
      } catch (err) {
        console.error("Falló la notificación de resumen:", err);
      }
    }

    await this.markNotified(sent);
  }

  /** Marcar lo enviado nunca puede tumbar una corrida que ya avisó bien. */
  private async markNotified(itemIds: string[]): Promise<void> {
    try {
      await this.dealRepository.markNotified(itemIds);
    } catch (err) {
      console.error("Falló el marcado de avisos enviados:", err);
    }
  }

  private toEvaluatedDeal(
    candidate: Candidate,
    listing: ListingDetail,
    qualified: boolean,
    rejectReason: string | undefined,
    score: number | null,
    isGreatDeal: boolean,
    isPriority = false,
  ) {
    const text = `${listing.title} ${listing.descriptionText}`;
    return {
      itemId: listing.id,
      title: listing.title,
      price: listing.price,
      currency: listing.currency,
      condition: listing.condition,
      cpuMatch: candidate.cpuLabel,
      url: listing.url,
      imageUrl: listing.imageUrl,
      qualified,
      rejectReason,
      score,
      isGreatDeal,
      isPriority,
      hasDescription: hasMeaningfulDescription(listing.descriptionText),
      hasBatteryInfo: mentionsBattery(text),
      batteryGrade: extractBatteryGrade(text),
      isAuction: listing.buyingOptions.includes("AUCTION"),
      hasBestOffer: listing.buyingOptions.includes("BEST_OFFER"),
      endDate: listing.endDate,
      sellerDescription: listing.sellerDescription,
      sellerDescriptionHtml: listing.sellerDescriptionHtml,
      aspects: listing.aspects,
      additionalImages: listing.additionalImages,
      sellerUsername: listing.sellerUsername,
      sellerFeedbackScore: listing.sellerFeedbackScore,
      sellerFeedbackPercentage: listing.sellerFeedbackPercentage,
      fingerprint: listingFingerprint(listing.title, listing.price),
    };
  }
}

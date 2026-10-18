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
import { createSpecialDealMatcher } from "../domain/special-deals.ts";
import { createUrgentDealMatcher, type UrgentDealMatcher } from "../domain/urgent-deals.ts";
import { createHighSpecMatcher } from "../domain/high-spec-exception.ts";
import { createExclusionRules, evaluateExclusions } from "../rules/exclusion-rules.ts";
import {
  extractBatteryGrade,
  extractRamGb,
  findCosmeticNote,
  hasMeaningfulDescription,
  listingFingerprint,
  mentionsBattery,
} from "../domain/hardware-signals.ts";

const PAGE_SIZE = 100;

interface Candidate {
  summary: ListingSummary;
  cpuLabel: string;
  cpuTier: number;
  specialLabel: string | null;
  specialDemoted: boolean;
}

/**
 * Toma una ventana rotativa del pool de vetas: cada corrida usa un tramo
 * distinto (según el id de corrida), así se cubre todo el pool a lo largo del
 * día sin gastar una llamada por veta en cada corrida. Las vetas especiales
 * van siempre, adelante, fuera de la rotación.
 */
export function selectProfiles(config: SearchConfig, rotationSeed: number): SearchProfile[] {
  const pool = config.searchProfiles;
  const rotating =
    pool.length === 0
      ? []
      : (() => {
          const count = Math.min(config.profilesPerRun, pool.length);
          const start = ((rotationSeed % pool.length) + pool.length) % pool.length;
          return Array.from({ length: count }, (_, i) => pool[(start + i) % pool.length]);
        })();
  return [...config.specialSearchProfiles, ...config.newListingProfiles, ...rotating];
}

/**
 * Estimación barata de cuánto promete un candidato, con lo único que se sabe
 * antes de gastar una llamada de detalle: el título y el precio del listado.
 * Es un reflejo del scoring real (CPU prioritaria, 16GB, línea que se revende
 * bien, y el precio como desempate), no un criterio aparte.
 */
function promiseOf(candidate: Candidate, config: SearchConfig, urgentMatcher: UrgentDealMatcher): number {
  const title = candidate.summary.title;
  let promise = candidate.cpuTier * 10;

  // Una posible OFERTA URGENTE tampoco puede quedar afuera por el tope de
  // candidatos: es lo que más importa, y las de $200-220 solo existen por ella.
  if (urgentMatcher.isUrgent(asPreScreenListing(candidate.summary), { lenient: true })) promise += 2000;

  // Una especial nunca puede quedar afuera por el tope de candidatos por
  // corrida: es justo lo que se está buscando (llegan ~10 por día).
  if (candidate.specialLabel && !candidate.specialDemoted) promise += 1000;

  if (config.priorityCpus.includes(candidate.cpuLabel)) promise += 40;
  if (extractRamGb(title) >= 16) promise += 35;

  const modelTier = config.modelTiers.find((tier) => new RegExp(tier.pattern, tier.flags).test(title));
  promise += (modelTier ? modelTier.weight : config.modelFallbackWeight) * 30;

  // Desempate: entre dos candidatos parecidos, el más barato deja más margen.
  const price = candidate.summary.price;
  if (price != null) promise += Math.max(0, (config.maxPriceUsd - price) / config.maxPriceUsd) * 10;

  return promise;
}

/** Lo que se sabe de un resultado de búsqueda antes de pedir su detalle (título y resumen). */
function asPreScreenListing(summary: ListingSummary): ListingDetail {
  return {
    ...summary,
    descriptionText: summary.shortDescription,
    sellerDescription: "",
    sellerDescriptionHtml: "",
    aspects: [],
    additionalImages: [],
  };
}

/**
 * Orden en que vale la pena interrumpir: primero las OFERTAS URGENTES, después
 * las especiales, las CPUs prioritarias, y dentro de cada grupo por puntaje.
 */
function betterFirst(a: EvaluatedDeal, b: EvaluatedDeal): number {
  if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1;
  const aTop = Boolean(a.specialLabel) && !a.specialDemoted;
  const bTop = Boolean(b.specialLabel) && !b.specialDemoted;
  if (aTop !== bTop) return aTop ? -1 : 1;
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
    const specialMatcher = createSpecialDealMatcher(config);
    const urgentMatcher = createUrgentDealMatcher(config);
    const highSpecMatcher = createHighSpecMatcher(config);
    // Dos juegos de reglas: el pre-descarte solo ve título y resumen, y ahí lo
    // que falta saber de una posible OFERTA URGENTE (RAM, disco) no descarta.
    const exclusionRules = createExclusionRules(config);
    const preScreenRules = createExclusionRules(config, true);
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
          // Para los modelos especiales, si el título no trae un modelo de CPU
          // reconocible, se deduce la generación del modelo (serie J = 11.ª):
          // sin esto se descartaban acá, antes de evaluarse siquiera.
          const special = specialMatcher.match(item.title);
          const cpu =
            cpuMatcher.match(item.title) ??
            cpuMatcher.match(`${item.title} ${item.shortDescription}`) ??
            (special ? specialMatcher.inferCpu(item.title, special) : null);
          if (cpu) {
            candidates.set(item.id, {
              summary: item,
              cpuLabel: cpu.label,
              cpuTier: cpu.tier,
              specialLabel: special?.label ?? null,
              specialDemoted: special ? specialMatcher.isDemoted(item.title, special) : false,
            });
          }
        }

        if (items.length < PAGE_SIZE) break;
      }
    }

    // 2. Sacar los ya evaluados en corridas anteriores.
    const unseenIds = await this.dealRepository.filterUnseen([...candidates.keys()]);

    // 2b. Lo ya conocido que volvió a aparecer en la búsqueda trae su precio
    //     actual gratis, sin gastar llamadas: si está en los resultados sigue a
    //     la venta, y en subastas el precio es la puja del momento.
    await this.refreshFromSearch(candidates, new Set(unseenIds));
    const unseen = unseenIds
      .map((id) => candidates.get(id)!)
      // Cuando hay más candidatos que presupuesto de llamadas de detalle, se
      // gastan en los más prometedores según lo que ya se sabe del título.
      // Antes se ordenaba por precio ascendente, que era coherente con el
      // scoring viejo ("más barato = mejor") pero contradice el actual: dejaba
      // el presupuesto en la punta barata y nunca llegaba a las máquinas que
      // realmente se compran.
      .sort((a, b) => promiseOf(b, config, urgentMatcher) - promiseOf(a, config, urgentMatcher));

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
        const asListing = asPreScreenListing(candidate.summary);
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
        const preScreen = asPreScreenListing(candidate.summary);
        const preScreenResult = evaluateExclusions(preScreenRules, preScreen);
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
          // Con el detalle completo: la RAM, el disco y los problemas ya se leen de verdad.
          qualifies && urgentMatcher.isUrgent(detail),
          qualifies && highSpecMatcher.isHighSpec(detail),
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
    // El refresco va antes del aviso de subastas: ese aviso filtra por precio,
    // y con la puja de cuando se encontró la subasta avisaba equipos que ya
    // iban muy por encima del tope.
    await this.refreshListings(config);
    await this.notifyClosingAuctions(config);
    return stats;
  }

  private async refreshFromSearch(candidates: Map<string, Candidate>, unseen: Set<string>): Promise<void> {
    const known = [...candidates.values()]
      .map((c) => c.summary)
      .filter((s) => !unseen.has(s.id));
    if (known.length === 0) return;

    try {
      await this.dealRepository.applyStatuses(
        known.map((s) => ({ id: s.id, available: true, price: s.price, bidCount: s.bidCount, endDate: s.endDate })),
      );
    } catch (err) {
      console.error("Falló el refresco desde la búsqueda:", err);
    }
  }

  /**
   * Consulta a eBay el estado actual de lo guardado, dentro del presupuesto de
   * llamadas de la corrida: las subastas por avisar primero, después lo que
   * encabeza el dashboard. Lo vendido o terminado se marca y sale del
   * dashboard; lo demás actualiza precio y pujas.
   */
  private async refreshListings(config: SearchConfig): Promise<void> {
    let ids: string[];
    try {
      ids = await this.dealRepository.findListingsToRefresh({
        limit: config.refreshCallsPerRun,
        staleMinutes: config.refreshStaleMinutes,
        alertWindowMinutes: config.refreshAlertWindowMinutes,
        alertMaxPrice: config.auctionAlertMaxPrice,
        scoreAbove: config.notifyScoreAbove,
        excludedSellers: config.auctionAlertExcludedSellers,
      });
    } catch (err) {
      console.error("Falló la selección de publicaciones a refrescar:", err);
      return;
    }

    const statuses = [];
    for (const id of ids) {
      try {
        statuses.push(await this.marketplace.getStatus(id));
      } catch (err) {
        // Sin respuesta no se marca nada: mejor un precio viejo que dar por
        // vendido algo que solo falló por un timeout.
        console.error(`Falló el refresco de ${id}:`, err);
      }
    }

    try {
      await this.dealRepository.applyStatuses(statuses);
    } catch (err) {
      console.error("Falló el guardado del refresco:", err);
    }
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
        maxMinutesLeft: config.auctionAlertMaxMinutesLeft,
        scoreAbove: config.notifyScoreAbove,
        excludedSellers: config.auctionAlertExcludedSellers,
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
   * Con el pool ampliado pueden salir decenas de ofertas por corrida. Solo se
   * avisa lo que supera notifyScoreAbove: las mejores una por una (prioritarias
   * primero, después por puntaje) y el resto en un solo mensaje de resumen.
   * Todas quedan igual en el dashboard.
   */
  private async notifyQualified(config: SearchConfig, deals: EvaluatedDeal[]): Promise<void> {
    // Primero el umbral de puntaje: lo que no lo supera no se avisa de ninguna
    // forma, ni suelto ni en el resumen. Las CPUs prioritarias no tienen
    // excepción. Las especiales (2 en 1) sí: con el umbral casi ninguna
    // avisaría — 58 de las 59 de compra directa disponibles al medir puntúan
    // 70 o menos, por los 8GB y por ser Latitude.
    const aboveThreshold = deals.filter(
      (d) => (d.specialLabel && !d.specialDemoted) || (d.score ?? 0) > config.notifyScoreAbove,
    );
    if (aboveThreshold.length === 0) return;

    // Después lo ya visto: no tiene sentido gastar el cupo de avisos de la
    // corrida en equipos que ya viste.
    const notifiable = await this.selectNotifiable(aboveThreshold);
    if (notifiable.length === 0) return;

    const individual = [...notifiable].sort(betterFirst).slice(0, config.maxNotificationsPerRun);
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
    isUrgent = false,
    isHighSpec = false,
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
      specialLabel: candidate.specialLabel,
      specialDemoted: candidate.specialDemoted,
      isUrgent,
      isHighSpec,
      cosmeticNote: findCosmeticNote(listing.title, listing.descriptionText),
      hasDescription: hasMeaningfulDescription(listing.descriptionText),
      hasBatteryInfo: mentionsBattery(text),
      batteryGrade: extractBatteryGrade(text),
      isAuction: listing.buyingOptions.includes("AUCTION"),
      hasBestOffer: listing.buyingOptions.includes("BEST_OFFER"),
      endDate: listing.endDate,
      bidCount: listing.bidCount,
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

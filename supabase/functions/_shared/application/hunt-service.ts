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
      // Si hay más candidatos que presupuesto de llamadas, primero los más
      // baratos: son los que más chance tienen de ser oferta.
      .sort((a, b) => (a.summary.price ?? Infinity) - (b.summary.price ?? Infinity));

    // 3. Colapsar republicaciones del mismo equipo (mismo título normalizado y
    //    precio), tanto dentro de esta corrida como contra lo ya guardado.
    const knownFingerprints = await this.dealRepository.findKnownFingerprints(
      unseen.map((c) => listingFingerprint(c.summary.title, c.summary.price)),
    );
    const seenThisRun = new Set<string>();
    const fresh: Candidate[] = [];
    for (const candidate of unseen) {
      const fingerprint = listingFingerprint(candidate.summary.title, candidate.summary.price);
      if (knownFingerprints.has(fingerprint) || seenThisRun.has(fingerprint)) {
        stats.duplicatesSkipped++;
        // Se guarda como descartado para que no vuelva a evaluarse en cada corrida.
        const asListing: ListingDetail = { ...candidate.summary, descriptionText: candidate.summary.shortDescription };
        await this.dealRepository.save(
          this.toEvaluatedDeal(candidate, asListing, false, "duplicate_listing", null, false),
        );
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

        const evaluatedDeal = this.toEvaluatedDeal(candidate, detail, qualifies, reason, score, isGreatDeal);
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

    await this.notifyQualified(config, qualifiedDeals);
    return stats;
  }

  /**
   * Con el pool ampliado pueden salir decenas de ofertas por corrida. Se avisan
   * una por una solo las que valen interrumpir (ofertazas, las de mejor puntaje
   * primero) y el resto va en un solo mensaje de resumen; todas quedan igual en
   * el dashboard.
   */
  private async notifyQualified(config: SearchConfig, deals: EvaluatedDeal[]): Promise<void> {
    if (deals.length === 0) return;

    const worthPinging = config.notifyOnlyGreatDeals ? deals.filter((d) => d.isGreatDeal) : deals;
    const individual = [...worthPinging]
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, config.maxNotificationsPerRun);
    const individualIds = new Set(individual.map((d) => d.itemId));

    for (const deal of individual) {
      try {
        await this.notificationChannel.notify(deal);
      } catch (err) {
        console.error(`Falló la notificación de ${deal.itemId}:`, err);
      }
    }

    const rest = deals.filter((d) => !individualIds.has(d.itemId));
    if (rest.length === 0) return;

    try {
      await this.notificationChannel.notifyDigest(
        [...rest].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)),
      );
    } catch (err) {
      console.error("Falló la notificación de resumen:", err);
    }
  }

  private toEvaluatedDeal(
    candidate: Candidate,
    listing: ListingDetail,
    qualified: boolean,
    rejectReason: string | undefined,
    score: number | null,
    isGreatDeal: boolean,
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
      hasDescription: hasMeaningfulDescription(listing.descriptionText),
      hasBatteryInfo: mentionsBattery(text),
      batteryGrade: extractBatteryGrade(text),
      isAuction: listing.buyingOptions.includes("AUCTION"),
      hasBestOffer: listing.buyingOptions.includes("BEST_OFFER"),
      endDate: listing.endDate,
      sellerUsername: listing.sellerUsername,
      sellerFeedbackScore: listing.sellerFeedbackScore,
      sellerFeedbackPercentage: listing.sellerFeedbackPercentage,
      fingerprint: listingFingerprint(listing.title, listing.price),
    };
  }
}

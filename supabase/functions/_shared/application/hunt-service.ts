import type {
  ConfigProvider,
  DealRepository,
  ListingSummary,
  MarketplaceClient,
  NotificationChannel,
  RunStats,
  ScoringStrategy,
  SearchConfig,
} from "../domain/types.ts";
import { createCpuMatcher, maxCpuTier } from "../cpu/cpu-matcher.ts";
import { createExclusionRules, evaluateExclusions } from "../rules/exclusion-rules.ts";
import { extractBatteryGrade, hasMeaningfulDescription, mentionsBattery } from "../domain/hardware-signals.ts";

/**
 * Orquesta una corrida completa: buscar -> matchear CPU -> filtrar ya vistos ->
 * traer detalle -> aplicar reglas de exclusión -> puntuar -> guardar -> notificar.
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

  async run(): Promise<RunStats> {
    const config = await this.configProvider.getConfig();
    const cpuMatcher = createCpuMatcher(config);
    const exclusionRules = createExclusionRules(config);
    const scoringStrategy = this.buildScoringStrategy(config);
    const maxTier = maxCpuTier(config);

    const stats: RunStats = { itemsScanned: 0, candidatesChecked: 0, itemsQualified: 0 };

    const candidates: { summary: ListingSummary; cpuLabel: string; cpuTier: number }[] = [];
    for (let page = 0; page < config.maxPages; page++) {
      const items = await this.marketplace.search(config, { page, pageSize: 100 });
      if (items.length === 0) break;
      stats.itemsScanned += items.length;

      for (const item of items) {
        const cpu = cpuMatcher.match(item.title);
        if (cpu) candidates.push({ summary: item, cpuLabel: cpu.label, cpuTier: cpu.tier });
      }

      if (items.length < 100) break;
    }

    const unseenIds = await this.dealRepository.filterUnseen(candidates.map((c) => c.summary.id));
    const unseenSet = new Set(unseenIds);
    const fresh = candidates.filter((c) => unseenSet.has(c.summary.id)).slice(0, config.maxCandidatesPerRun);

    for (const candidate of fresh) {
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

      const evaluatedDeal = {
        itemId: detail.id,
        title: detail.title,
        price: detail.price,
        currency: detail.currency,
        condition: detail.condition,
        cpuMatch: candidate.cpuLabel,
        url: detail.url,
        imageUrl: detail.imageUrl,
        qualified: qualifies,
        rejectReason: reason,
        score,
        isGreatDeal,
        hasDescription: hasMeaningfulDescription(detail.descriptionText),
        hasBatteryInfo: mentionsBattery(`${detail.title} ${detail.descriptionText}`),
        batteryGrade: extractBatteryGrade(`${detail.title} ${detail.descriptionText}`),
        isAuction: detail.buyingOptions.includes("AUCTION"),
      };

      await this.dealRepository.save(evaluatedDeal);

      if (qualifies) {
        stats.itemsQualified++;
        await this.notificationChannel.notify(evaluatedDeal);
      }
    }

    return stats;
  }
}

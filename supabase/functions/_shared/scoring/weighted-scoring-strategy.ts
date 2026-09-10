import type { ListingDetail, ScoreFactor, ScoringContext, ScoringResult, ScoringStrategy, SearchConfig } from "../domain/types.ts";
import { DEFAULT_SCORE_FACTORS } from "./factors.ts";

/**
 * Combina una lista de ScoreFactor pluggeable en un puntaje 0-100. Agregar un
 * factor nuevo (ej. "cantidad de puertos", "peso") es sumarlo a la lista sin
 * tocar esta clase — Open/Closed.
 */
export function createWeightedScoringStrategy(
  config: SearchConfig,
  factors: ScoreFactor[] = DEFAULT_SCORE_FACTORS,
): ScoringStrategy {
  return {
    score(listing: ListingDetail, ctx: ScoringContext): ScoringResult {
      const weighted = factors.reduce((sum, factor) => sum + factor.score(listing, ctx) * factor.weight, 0);
      const score = Math.round(weighted * 100);
      const isGreatDeal =
        (listing.price != null && listing.price <= config.greatDealMaxPrice) ||
        score >= config.greatDealMinScore;
      return { score, isGreatDeal };
    },
  };
}

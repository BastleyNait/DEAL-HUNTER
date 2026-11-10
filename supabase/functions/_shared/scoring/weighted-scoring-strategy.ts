import type { ListingDetail, ScoreFactor, ScoringContext, ScoringResult, ScoringStrategy, SearchConfig } from "../domain/types.ts";
import { createModelFactor, DEFAULT_SCORE_FACTORS } from "./factors.ts";
import { createScorePenalties, penaltyPoints } from "./penalties.ts";
import { gpuOf, gpuScoreBonus } from "../domain/gpu-priority.ts";
import { extractRamGb } from "../domain/hardware-signals.ts";

/**
 * Combina una lista de ScoreFactor pluggeable en un puntaje 0-100. Agregar un
 * factor nuevo (ej. "cantidad de puertos", "peso") es sumarlo a la lista sin
 * tocar esta clase — Open/Closed.
 */
export function createWeightedScoringStrategy(
  config: SearchConfig,
  factors: ScoreFactor[] = [
    ...DEFAULT_SCORE_FACTORS,
    createModelFactor(config.modelTiers, config.modelFallbackWeight),
  ],
): ScoringStrategy {
  const penalties = createScorePenalties(config.scorePenalties);

  return {
    score(listing: ListingDetail, ctx: ScoringContext): ScoringResult {
      const weighted = factors.reduce((sum, factor) => sum + factor.score(listing, ctx) * factor.weight, 0);
      // Las penalizaciones se restan antes de decidir si es ofertaza, así una
      // Latitude que quedaba justo en el umbral deja de serlo.
      // Una penalización negativa suma (ej. "Incluye cargador"), así que se
      // acota también por arriba.
      // Y una gráfica dedicada suma: es el tipo de laptop que más margen deja.
      const gpuBonus = gpuScoreBonus(gpuOf(listing), config.gpuPriority);
      const score = Math.min(
        100,
        Math.max(0, Math.round(weighted * 100) - penaltyPoints(penalties, listing) + gpuBonus),
      );

      // Una subasta nunca es "ofertaza": el precio que vemos es la puja actual,
      // no lo que vas a terminar pagando, así que no hay forma de afirmar que
      // sea una ganga. El puntaje se calcula igual para poder ordenarlas.
      const isAuction = listing.buyingOptions.includes("AUCTION");
      // Por puntaje, o por muy barato con 16GB o más: "barato" a secas dejaba
      // pasar de ofertaza equipos flojos, pero 16GB a $130 es ofertaza aunque
      // el puntaje quede en 70.
      const cheap = config.cheapGreatDeal;
      const isCheapGreat =
        listing.price != null &&
        listing.price <= cheap.maxPriceUsd &&
        score >= cheap.minScore &&
        extractRamGb(`${listing.title} ${listing.descriptionText}`) >= cheap.minRamGb;
      const isGreatDeal = !isAuction && (score >= config.greatDealMinScore || isCheapGreat);

      return { score, isGreatDeal };
    },
  };
}

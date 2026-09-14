import type { ListingDetail, ScorePenaltyConfig } from "../domain/types.ts";
import { mentionsOutsideContext } from "../domain/hardware-signals.ts";

export interface ScorePenalty {
  label: string;
  points: number;
  applies(listing: ListingDetail): boolean;
}

/**
 * Compila las restas de puntaje de la config. Van aparte de los factores
 * ponderados porque no son un grado (0..1) sino un castigo fijo: "es Latitude"
 * o "declara daño" resta lo mismo en una máquina de 60 puntos que en una de 90.
 */
export function createScorePenalties(configs: ScorePenaltyConfig[]): ScorePenalty[] {
  return configs.map((config) => {
    const pattern = new RegExp(config.pattern, config.flags);
    // Sin "g": test() con una regex global guarda estado entre llamadas.
    const ignoreContext = config.ignoreContextPattern
      ? new RegExp(config.ignoreContextPattern, config.flags.replace("g", ""))
      : undefined;

    return {
      label: config.label,
      points: config.points,
      applies(listing: ListingDetail) {
        const text =
          config.scope === "title" ? listing.title : `${listing.title}\n${listing.descriptionText}`;
        return mentionsOutsideContext(text, pattern, { ignoreNegated: config.ignoreNegated, ignoreContext });
      },
    };
  });
}

/** Total de puntos a restar: cada penalización cuenta una sola vez por listing. */
export function penaltyPoints(penalties: ScorePenalty[], listing: ListingDetail): number {
  return penalties.reduce((total, penalty) => total + (penalty.applies(listing) ? penalty.points : 0), 0);
}

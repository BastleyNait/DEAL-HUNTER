import type { ListingDetail, SearchConfig } from "./types.ts";
import { createCpuMatcher } from "../cpu/cpu-matcher.ts";
import { mentionsOutsideContext } from "./hardware-signals.ts";
import { meetsSpecs, readSpecs } from "./listing-specs.ts";

export interface UrgentDealMatcher {
  /**
   * true si la publicación es OFERTA URGENTE: compra directa, bajo el tope,
   * con la CPU, la RAM y el disco pedidos y sin hablar de problemas.
   *
   * `lenient` es para el pre-descarte (ver meetsSpecs).
   */
  isUrgent(listing: ListingDetail, options?: { lenient?: boolean }): boolean;
}

export function createUrgentDealMatcher(config: SearchConfig): UrgentDealMatcher {
  const urgent = config.urgentDeal;
  const cpuMatcher = createCpuMatcher(config);
  const cpuLabels = new Set(urgent.cpuLabels);
  const issueRe = new RegExp(urgent.issuePattern, urgent.issueFlags);
  const issueContextRe = new RegExp(urgent.issueIgnoreContextPattern, "i");

  return {
    isUrgent(listing, options) {
      const lenient = options?.lenient ?? false;

      if (listing.price == null || listing.price > urgent.maxPriceUsd) return false;
      if (listing.buyingOptions.includes("AUCTION")) return false;

      // Misma lectura de CPU que la selección de candidatos (título y, si no,
      // el resumen): así este criterio y el de la búsqueda no se contradicen.
      const cpu = cpuMatcher.match(listing.title) ?? cpuMatcher.match(`${listing.title} ${listing.shortDescription}`);
      if (!cpu || !cpuLabels.has(cpu.label)) return false;

      const specs = readSpecs(listing);
      if (!meetsSpecs(specs, { ramGb: urgent.minRamGb, storageGb: urgent.minStorageGb }, lenient)) return false;

      return !mentionsOutsideContext(specs.text, issueRe, { ignoreNegated: true, ignoreContext: issueContextRe });
    },
  };
}

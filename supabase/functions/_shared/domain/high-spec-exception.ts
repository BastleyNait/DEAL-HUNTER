import type { ListingDetail, SearchConfig } from "./types.ts";
import { meetsSpecs, readSpecs } from "./listing-specs.ts";

export interface HighSpecMatcher {
  /**
   * true si entra por la excepción de ficha: hasta el tope de la excepción,
   * con la RAM y el disco (SSD) mínimos. `lenient` es para el pre-descarte
   * (ver meetsSpecs).
   */
  isHighSpec(listing: ListingDetail, options?: { lenient?: boolean }): boolean;
}

export function createHighSpecMatcher(config: SearchConfig): HighSpecMatcher {
  const rule = config.highSpecException;
  return {
    isHighSpec(listing, options) {
      if (listing.price == null || listing.price > rule.maxPriceUsd) return false;
      return meetsSpecs(
        readSpecs(listing),
        { ramGb: rule.minRamGb, storageGb: rule.minStorageGb },
        options?.lenient ?? false,
      );
    },
  };
}

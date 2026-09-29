import type { CpuMatch, SearchConfig, SpecialDealConfig } from "./types.ts";

export interface SpecialDealMatcher {
  /** El modelo especial que matchea el título, o null. */
  match(title: string): SpecialDealConfig | null;
  /** true si ese título es del tipo especial pero de prioridad baja (las Dell). */
  isDemoted(title: string, special: SpecialDealConfig): boolean;
  /**
   * CPU deducida del modelo, para cuando el título no trae un modelo de
   * procesador reconocible. Una compra real de $153.78 ("Portege X30W-J ...
   * i5 2.49GHz/8GB/256GB") se hubiera descartado en el primer paso por esto:
   * el matcher de CPU necesita el modelo ("i5-1135G7") o la generación
   * explícita ("11th gen"), y ese título no trae ninguna de las dos.
   */
  inferCpu(title: string, special: SpecialDealConfig): CpuMatch | null;
}

// Solo i5 e i7: un i3 no es "de lo mejor en su rango" aunque sea el mismo
// chasis, así que no se deduce nada y la publicación sigue su curso normal.
const INTEL_FAMILY_RE = /\b(?:core\s*)?i([57])\b/i;
const INTEL_I3_RE = /\b(?:core\s*)?i3\b/i;

export function createSpecialDealMatcher(config: SearchConfig): SpecialDealMatcher {
  const compiled = config.specialDeals.map((special) => ({
    special,
    regex: new RegExp(special.pattern, special.flags),
    exclude: special.excludePattern ? new RegExp(special.excludePattern, special.flags) : null,
    demote: special.demotePattern ? new RegExp(special.demotePattern, special.flags) : null,
  }));

  return {
    match(title: string) {
      return compiled.find((c) => c.regex.test(title) && !c.exclude?.test(title))?.special ?? null;
    },

    isDemoted(title: string, special: SpecialDealConfig) {
      return compiled.find((c) => c.special === special)?.demote?.test(title) ?? false;
    },

    inferCpu(title: string, special: SpecialDealConfig) {
      if (special.impliedIntelGeneration == null) return null;
      if (INTEL_I3_RE.test(title)) return null;
      // Sin familia en el título se asume i5: es la configuración base de toda
      // la serie, así que es la suposición conservadora (tier más bajo).
      const family = title.match(INTEL_FAMILY_RE)?.[1] ?? "5";
      // Mismo formato de etiqueta que cpuPatterns, para heredar su tier y que
      // el puntaje trate igual a "i5-1135G7" que a "i5 2.49GHz" del mismo modelo.
      const label = `Intel i${family} ${special.impliedIntelGeneration}th gen`;
      const pattern = config.cpuPatterns.find((p) => p.label === label);
      return pattern ? { label: pattern.label, tier: pattern.tier } : null;
    },
  };
}

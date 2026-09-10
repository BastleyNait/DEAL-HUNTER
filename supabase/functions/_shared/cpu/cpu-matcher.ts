import type { CpuMatch, CpuMatcher, SearchConfig } from "../domain/types.ts";

/** Construye un CpuMatcher a partir de los patrones definidos en el SearchConfig activo. */
export function createCpuMatcher(config: SearchConfig): CpuMatcher {
  const compiled = config.cpuPatterns.map((p) => ({
    label: p.label,
    tier: p.tier,
    regex: new RegExp(p.pattern, p.flags),
  }));

  return {
    match(title: string): CpuMatch | null {
      for (const p of compiled) {
        if (p.regex.test(title)) return { label: p.label, tier: p.tier };
      }
      return null;
    },
  };
}

export function maxCpuTier(config: SearchConfig): number {
  return Math.max(1, ...config.cpuPatterns.map((p) => p.tier));
}

import type { SearchConfig } from "./types.ts";

/**
 * ¿Va primero? Por CPU (config.priorityCpus: las i7 10.ª/11.ª/12.ª, que son
 * las que más salen) o por línea (config.priorityModels: ThinkPad serie X).
 * Encabeza el dashboard y los avisos, y en la selección de candidatos suma.
 */
export function createPriorityCheck(config: SearchConfig) {
  const cpus = new Set(config.priorityCpus);
  const models = (config.priorityModels ?? []).map((m) => new RegExp(m.pattern, m.flags));
  return (cpuLabel: string | null | undefined, title: string): boolean =>
    (cpuLabel != null && cpus.has(cpuLabel)) || models.some((re) => re.test(title));
}

import type { CpuMatch, ListingDetail, SearchConfig, WorkstationModelConfig } from "./types.ts";

/**
 * Deduce la CPU de una estación de trabajo por su modelo, para cuando el
 * título no trae el número de procesador. Caso real: "Lenovo ThinkPad P15s Gen 1
 * 15.6" 16GB RAM 256GB SSD" a $230, con "Intel Core i7" solo en los datos.
 * El matcher de CPU no encontraba nada y se perdía sin guardarse siquiera.
 *
 * Primero con lo que trae la búsqueda (título + shortDescription). Si ahí no
 * se dice si es i5 o i7, se supone i7 de forma PROVISIONAL (así llega a la
 * llamada de detalle) y después se confirma con los datos del detalle
 * (confirmFamily): si resulta i5 de una generación que no se busca, se descarta.
 */
export interface WorkstationInference extends CpuMatch {
  /** true si la familia (i5/i7) se supuso y hay que confirmarla con el detalle. */
  familyAssumed: boolean;
  generation: number;
}

const FAMILY_RE = /\b(?:core[\s™®]*)?i([3579])\b|\bi([3579])[\s-]?\d{4,5}/i;
// Un modelo AMD del mismo chasis (P14s Gen 2 AMD) no es Intel.
const AMD_RE = /\b(?:amd|ryzen)\b/i;

/**
 * Estaciones de trabajo confiables por el título: ThinkPad P, HP ZBook, Dell
 * Precision. Mismo criterio que el tope de $260 (brandPriceCaps).
 */
export const WORKSTATION_TITLE_PATTERN =
  "\\bthink\\s*pad\\s*p\\d|\\bp1[457][sv]?\\s*(?:gen|g)\\s*\\d|\\bp1\\s*gen\\s*\\d|\\b(?:lenovo|thinkpad)\\b.*\\bp[57][23]\\b|\\bzbook\\b|\\bprecision\\b";
const WORKSTATION_TITLE_RE = new RegExp(WORKSTATION_TITLE_PATTERN, "i");

function intelPattern(family: number, gen: number, tier: number) {
  // 8.ª y 9.ª tienen modelos de 4 dígitos (i9-9880H); de 10.ª en adelante, 5 o 6 (i9-12900H).
  const model = gen >= 10 ? `${gen}\\d{2,3}` : `${gen}\\d{3}`;
  return {
    label: `Intel i${family} ${gen}th gen`,
    tier,
    pattern: `\\bi${family}[\\s®™_-]*${model}[a-z0-9]{0,3}\\b|(?=.*\\bi${family}\\b)(?=.*\\b${gen}[\\s-]*(?:th)?[\\s-]*gen(?:eration)?\\b)`,
    flags: "i",
  };
}

/**
 * CPUs que solo valen en una estación de trabajo: en una de estas, una i9 de
 * 8.ª/9.ª o una i7 de 9.ª (P53, ZBook 15 G6, Precision 7540) sigue rindiendo
 * para diseño y se revende bien; en una laptop común no se buscan. Las i9 de
 * 10.ª a 12.ª tampoco estaban en la lista general. Tiers en la misma escala
 * que cpuPatterns (i7 12.ª = 8).
 */
export const WORKSTATION_CPU_PATTERNS = [
  intelPattern(9, 12, 8),
  intelPattern(9, 11, 7),
  intelPattern(9, 10, 5),
  intelPattern(9, 9, 4),
  intelPattern(9, 8, 3),
  intelPattern(7, 9, 3),
];

export function familyOf(text: string): string | null {
  const m = text.match(FAMILY_RE);
  return m ? (m[1] ?? m[2]) : null;
}

export function createWorkstationModelMatcher(config: SearchConfig) {
  const models = (config.workstationModels ?? []).map((m: WorkstationModelConfig) => ({
    ...m,
    regex: new RegExp(m.pattern, m.flags),
  }));
  const byLabel = new Map([...config.cpuPatterns, ...WORKSTATION_CPU_PATTERNS].map((p) => [p.label, p.tier]));
  const workstationCpus = WORKSTATION_CPU_PATTERNS.map((p) => ({ ...p, regex: new RegExp(p.pattern, p.flags) }));
  const matchFor = (family: string, generation: number): CpuMatch | null => {
    const label = `Intel i${family} ${generation}th gen`;
    const tier = byLabel.get(label);
    return tier == null ? null : { label, tier };
  };

  return {
    /** El modelo de estación de trabajo que matchea el título, o null. */
    model(title: string) {
      if (AMD_RE.test(title)) return null;
      return models.find((m) => m.regex.test(title)) ?? null;
    },

    /**
     * i9 (8.ª a 12.ª) o i7 de 9.ª dichas en el texto, solo si el título es de
     * una estación de trabajo. Una Alienware o una MSI con i9 no entra por acá.
     */
    matchCpu(title: string, shortDescription = ""): CpuMatch | null {
      if (!WORKSTATION_TITLE_RE.test(title)) return null;
      for (const text of [title, `${title} ${shortDescription}`]) {
        const hit = workstationCpus.find((p) => p.regex.test(text));
        if (hit) return { label: hit.label, tier: hit.tier };
      }
      return null;
    },

    infer(title: string, shortDescription = ""): WorkstationInference | null {
      const model = this.model(title);
      if (!model) return null;
      const family = familyOf(title) ?? familyOf(shortDescription);
      if (family) {
        const match = matchFor(family, model.impliedIntelGeneration);
        return match ? { ...match, familyAssumed: false, generation: model.impliedIntelGeneration } : null;
      }
      // Sin familia: i7 provisional, se confirma con el detalle.
      const provisional = matchFor("7", model.impliedIntelGeneration);
      return provisional ? { ...provisional, familyAssumed: true, generation: model.impliedIntelGeneration } : null;
    },

    /**
     * Con el detalle completo: la familia sale del dato "Processor" de eBay, del
     * título o de la descripción. null = no se buscan (i5 10.ª, i3) o no se sabe.
     */
    confirmFamily(detail: ListingDetail, generation: number): CpuMatch | { rejectReason: string } {
      const processor = (detail.aspects ?? [])
        .filter((a) => /processor|cpu/i.test(a.name))
        .map((a) => a.value)
        .join(" ");
      const family = familyOf(processor) ?? familyOf(detail.title) ?? familyOf(detail.descriptionText ?? "");
      if (!family) return { rejectReason: "cpu_family_unknown" };
      return matchFor(family, generation) ?? { rejectReason: `cpu_not_wanted_i${family}_${generation}th_gen` };
    },
  };
}

/**
 * Modelos y la generación Intel de cada uno, buscados en las fichas de Lenovo,
 * HP y Dell. Solo las líneas de estación de trabajo, que son las confiables
 * (chasis de gama alta, se revenden bien). Lo que no dice la generación
 * ("P15s" sin "Gen") no se deduce: hay de 10.ª y de 11.ª con el mismo nombre.
 */
function lenovoGen(model: string, gen: number, cpuGen: number): WorkstationModelConfig {
  return {
    label: `ThinkPad ${model} Gen ${gen}`,
    pattern: `\\b(?:think\\s*pad\\s*)?${model}\\s*(?:gen|g)\\s*${gen}\\b`,
    flags: "i",
    impliedIntelGeneration: cpuGen,
  };
}

function zbook(gen: number, cpuGen: number): WorkstationModelConfig {
  return {
    label: `ZBook G${gen}`,
    pattern: `\\bzbook\\b(?=.*\\b(?:firefly|power|studio|fury|create)\\b).*\\bg${gen}\\b`,
    flags: "i",
    impliedIntelGeneration: cpuGen,
  };
}

function precision(models: string[], cpuGen: number): WorkstationModelConfig {
  return {
    label: `Precision ${models.join("/")}`,
    pattern: `\\bprecision\\b.*\\b(?:${models.join("|")})\\b`,
    flags: "i",
    impliedIntelGeneration: cpuGen,
  };
}

export const DEFAULT_WORKSTATION_MODELS: WorkstationModelConfig[] = [
  // ThinkPad P14s / P15s / P15v / P15 / P17: Gen 1 = 10.ª, Gen 2 = 11.ª, Gen 3 = 12.ª.
  ...["p14s", "p15s", "p15v", "p15", "p17"].flatMap((m) => [lenovoGen(m, 1, 10), lenovoGen(m, 2, 11), lenovoGen(m, 3, 12)]),
  // ThinkPad P1: Gen 3 = 10.ª, Gen 4 = 11.ª, Gen 5 = 12.ª.
  lenovoGen("p1", 3, 10),
  lenovoGen("p1", 4, 11),
  lenovoGen("p1", 5, 12),
  // HP ZBook Firefly / Power / Studio / Fury / Create: G7 = 10.ª, G8 = 11.ª, G9 = 12.ª.
  zbook(7, 10),
  zbook(8, 11),
  zbook(9, 12),
  // Dell Precision por número de modelo.
  precision(["3550", "3551", "5550", "5750", "7550", "7750"], 10),
  precision(["3560", "3561", "5560", "5760", "7560", "7760"], 11),
  precision(["3570", "3571", "5570", "5770", "7670", "7770"], 12),
  // Generaciones anteriores. Sin decir i5/i7/i9 se supone i7 y se confirma con
  // el detalle; en las de 8.ª solo vale la i9 (la i7 8.ª no se busca), así que
  // ahí tiene que decir i9 en el título o el resumen.
  // ThinkPad P53 / P73 = 9.ª, P52 / P72 = 8.ª, P1 Gen 2 = 9.ª, P1 Gen 1 = 8.ª.
  { label: "ThinkPad P53/P73", pattern: "\\b(?:lenovo|thinkpad|think\\s*pad)\\b.*\\bp[57]3\\b", flags: "i", impliedIntelGeneration: 9 },
  { label: "ThinkPad P52/P72", pattern: "\\b(?:lenovo|thinkpad|think\\s*pad)\\b.*\\bp[57]2\\b", flags: "i", impliedIntelGeneration: 8 },
  lenovoGen("p1", 2, 9),
  lenovoGen("p1", 1, 8),
  // ZBook 15 / 17: G6 = 9.ª, G5 = 8.ª (las Firefly y 14u/15u de esos años son
  // de bajo consumo, otra cosa: por eso solo las 15 y 17).
  { label: "ZBook 15/17 G6", pattern: "\\bzbook\\s*1[57]\\s*g6\\b", flags: "i", impliedIntelGeneration: 9 },
  { label: "ZBook 15/17 G5", pattern: "\\bzbook\\s*1[57]\\s*g5\\b", flags: "i", impliedIntelGeneration: 8 },
  precision(["3541", "5540", "7540", "7740"], 9),
  precision(["3530", "5530", "7530", "7730"], 8),
];

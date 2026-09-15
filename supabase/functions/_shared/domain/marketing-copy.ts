import type { ListingAspect, ModelTierConfig } from "./types.ts";
import { extractBatteryPercent, extractRamGb, extractStorageGb } from "./hardware-signals.ts";

/**
 * El título y la descripción que trae eBay están escritos para que el
 * algoritmo de búsqueda de eBay los encabece de specs ("LENOVO THINKPAD L14
 * G2 | CORE I7-1165G7 | 512GB | 16GB | WIN11P | REFURBISHED"), no para que un
 * comprador en Facebook entienda de un vistazo para qué le sirve el equipo.
 * Esto arma copy en español pensado para ese comprador: qué es, para qué lo
 * usa, y recién después las specs como respaldo.
 *
 * Es reglas, no IA: determinístico, sin costo por publicación, y en el mismo
 * idioma que ya entiende el resto del sistema (cpuPatterns, modelTiers). Deja
 * un puerto (MarketingCopyGenerator más abajo) para poder enchufar generación
 * con IA el día que haga falta texto más variado, sin tocar quien lo llama.
 */

export interface MarketingCopyInput {
  title: string;
  descriptionText: string;
  condition: string | null;
  aspects: ListingAspect[];
  cpuLabel: string | null;
  modelTiers: ModelTierConfig[];
}

export interface MarketingCopy {
  title: string;
  description: string;
}

export interface MarketingCopyGenerator {
  generate(input: MarketingCopyInput): MarketingCopy;
}

type Audience = "convertible" | "premium" | "business" | "portable" | "everyday";

const CONVERTIBLE_RE = /\b(yoga|x360|2[\s-]?in[\s-]?1|convertible|flip)\b/i;

// Reutiliza las mismas etiquetas de modelTiers (default-config.ts) para no
// mantener un segundo criterio de "qué es esta línea" en otro lado.
const AUDIENCE_BY_MODEL_LABEL: Record<string, Audience> = {
  "ThinkPad T / X / P": "premium",
  "HP EliteBook / ZBook": "premium",
  "Dell Precision / Surface Laptop": "premium",
  "Dynabook Portégé / Tecra": "portable",
  "ThinkPad (cualquier línea)": "business",
  "Dell Latitude": "business",
  "HP ProBook": "business",
};

const AUDIENCE_COPY: Record<Audience, { hook: string; bullet: string }> = {
  convertible: {
    hook: "convertible en tablet, pantalla táctil",
    bullet: "La pantalla gira 360° y es táctil: sirve como laptop y como tablet para tomar apuntes o dibujar.",
  },
  premium: {
    hook: "de gama alta, para trabajo profesional",
    bullet: "Línea empresarial de gama alta: construcción sólida, pensada para uso profesional intensivo.",
  },
  business: {
    hook: "para oficina y estudio",
    bullet: "Línea empresarial: liviana, confiable y pensada para trabajar o estudiar todo el día.",
  },
  portable: {
    hook: "ultraliviana para llevar a todos lados",
    bullet: "Diseño ultraliviano: ideal si te movés seguido y no querés cargar peso de más.",
  },
  everyday: {
    hook: "para trabajo, estudio y uso diario",
    bullet: "Anda bien para lo de todos los días: navegar, oficina, clases virtuales y streaming.",
  },
};

function detectAudience(title: string, modelTiers: ModelTierConfig[]): Audience {
  if (CONVERTIBLE_RE.test(title)) return "convertible";

  for (const tier of modelTiers) {
    if (new RegExp(tier.pattern, tier.flags).test(title) && tier.label in AUDIENCE_BY_MODEL_LABEL) {
      return AUDIENCE_BY_MODEL_LABEL[tier.label];
    }
  }
  return "everyday";
}

/** "Intel i5 11th gen" -> "Intel Core i5 (11.ª generación)". Formato fijo, sale de cpuPatterns. */
export function simplifyCpu(cpuLabel: string | null): string | null {
  if (!cpuLabel) return null;

  const intel = cpuLabel.match(/^Intel i(\d) (\d{1,2})(?:st|nd|rd|th) gen$/i);
  if (intel) return `Intel Core i${intel[1]} (${intel[2]}.ª generación)`;

  const amd = cpuLabel.match(/^AMD Ryzen (\d) (\d{3,4})$/i);
  if (amd) return `AMD Ryzen ${amd[1]} (serie ${amd[2]})`;

  return cpuLabel;
}

export function brandFromTitle(title: string): string {
  const known = ["Lenovo", "ThinkPad", "Dell", "Latitude", "HP", "EliteBook", "ProBook", "Dynabook", "Toshiba", "Asus", "Acer", "Microsoft", "Surface"];
  const found = known.find((brand) => new RegExp(`\\b${brand}\\b`, "i").test(title));
  // Reordenado: la marca real primero, aunque el título original la tenga
  // después de la línea comercial ("ThinkPad L14 by Lenovo" no existe, pero
  // por si acaso, se prioriza el nombre de fabricante sobre el de línea).
  if (found === "ThinkPad") return "Lenovo";
  if (found === "Latitude" || found === "EliteBook" || found === "ProBook") {
    return found === "Latitude" ? "Dell" : "HP";
  }
  if (found === "Toshiba") return "Dynabook";
  if (found === "Surface") return "Microsoft";
  return found ?? "";
}

export function conditionLabel(condition: string | null): string {
  if (!condition) return "usada, en buen estado";
  if (/refurbished/i.test(condition)) return "reacondicionada y probada";
  if (/^new/i.test(condition)) return "nueva, sin uso";
  return "usada, en buen estado";
}

/**
 * Grado de condición para el campo `conditionGrade` de REVOLT-LAP. Distinto de
 * conditionLabel: ese es la frase en español para el copy de venta, este es
 * el valor corto en inglés-mayúsculas que ya usa el catálogo en producción
 * ("REFURBISHED" en los productos existentes) — se sigue esa convención en
 * vez de inventar una nueva.
 */
export function storeConditionGrade(condition: string | null): string {
  return condition && /refurbished/i.test(condition) ? "REFURBISHED" : "USED";
}

const MAX_TITLE_LENGTH = 100; // Tope real de Facebook Marketplace.

function buildTitle(brand: string, audience: Audience, ram: number, storageGb: number): string {
  const hook = AUDIENCE_COPY[audience].hook;
  const storage = storageGb >= 1000 ? `${Math.round(storageGb / 1000)}TB` : storageGb > 0 ? `${storageGb}GB` : "";
  const specs = [ram > 0 ? `${ram}GB RAM` : null, storage ? `${storage} SSD` : null].filter(Boolean).join(", ");

  const parts = [`Laptop ${brand}`.trim(), hook, specs].filter((p) => p && p.length > 0);
  let title = parts.join(" — ");
  if (title.length > MAX_TITLE_LENGTH) title = title.slice(0, MAX_TITLE_LENGTH - 1).trimEnd() + "…";
  return title;
}

function buildDescription(
  audience: Audience,
  cpuSimplified: string | null,
  ram: number,
  storageGb: number,
  conditionText: string,
  batteryPct: number | null,
): string {
  const storage = storageGb >= 1000 ? `${Math.round(storageGb / 1000)}TB` : storageGb > 0 ? `${storageGb}GB` : null;

  const specLines = [
    cpuSimplified ? `💻 Procesador: ${cpuSimplified}` : null,
    ram > 0 ? `🧠 Memoria RAM: ${ram}GB` : null,
    storage ? `💾 Almacenamiento: ${storage} SSD (arranque rápido)` : null,
    batteryPct != null ? `🔋 Batería: ${batteryPct}% de su capacidad original` : null,
  ].filter((l): l is string => Boolean(l));

  const lines = [
    AUDIENCE_COPY[audience].bullet,
    "",
    ...specLines,
    "",
    `✅ Laptop ${conditionText}, revisada antes de publicar.`,
    "🛡️ Garantía de 6 meses incluida.",
    "🚚 Envío disponible.",
    "",
    "Escribime y coordinamos 🙂",
  ];
  return lines.join("\n");
}

/** Implementación por reglas. Ver el comentario de arriba del archivo. */
export const ruleBasedMarketingCopy: MarketingCopyGenerator = {
  generate(input: MarketingCopyInput): MarketingCopy {
    const audience = detectAudience(input.title, input.modelTiers);
    const brand = brandFromTitle(input.title) || "";
    const ram = extractRamGb(`${input.title} ${input.descriptionText}`);
    const storageGb = extractStorageGb(`${input.title} ${input.descriptionText}`);
    const battery = extractBatteryPercent(`${input.title} ${input.descriptionText}`);
    const cpuSimplified = simplifyCpu(input.cpuLabel);
    const conditionText = conditionLabel(input.condition);

    return {
      title: buildTitle(brand, audience, ram, storageGb),
      description: buildDescription(audience, cpuSimplified, ram, storageGb, conditionText, battery),
    };
  },
};

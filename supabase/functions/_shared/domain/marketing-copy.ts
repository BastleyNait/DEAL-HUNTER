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
  "Dell premium (Latitude 7000/9000, XPS, Precision)": "premium",
  "ThinkPad T / X / P": "premium",
  "HP EliteBook / ZBook": "premium",
  "Dell Precision / Surface Laptop": "premium",
  "Dynabook Portégé / Tecra": "portable",
  "ThinkPad (cualquier línea)": "business",
  "Lenovo ThinkBook": "business",
  "Dell Latitude": "business",
  "HP ProBook": "business",
};

const AUDIENCE_COPY: Record<Audience, { hook: string; bullet: string }> = {
  convertible: {
    hook: "convertible en tablet, pantalla táctil",
    bullet: "La pantalla gira 360° y es táctil: sirve como laptop y como tablet para tomar apuntes o dibujar.",
  },
  premium: {
    // Esta franja sí es mayormente carcasa de aluminio/magnesio (ThinkPad
    // T/X/P, EliteBook/ZBook, Precision) — no se generaliza a las otras
    // franjas (Latitude, ProBook, E-series), que en su mayoría son plástico.
    hook: "de gama alta, para trabajo profesional",
    bullet: "Línea empresarial de gama alta: construcción premium en aluminio, pensada para uso profesional intensivo.",
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

/**
 * Encabezado y párrafo de apertura de la descripción. El tono sigue el modelo
 * que armaste a mano para la ThinkPad E14 Gen 2: primero a quién está
 * dirigida, después por qué el procesador la hace buena para eso.
 */
type Headline = "highEnd" | "convertible" | "portable" | "business" | "everyday";

const HEADLINE_COPY: Record<Headline, { title: string; intro: string }> = {
  highEnd: {
    title: "Rendimiento de Alta Gama",
    intro: "Diseñada para profesionales, programadores y estudiantes avanzados que requieren máxima velocidad en su día a día.",
  },
  convertible: {
    title: "Versatilidad 2 en 1",
    intro:
      "Laptop y tablet en un solo equipo: su pantalla táctil gira 360° para presentar, tomar apuntes o dibujar, ideal para estudiantes y profesionales en movimiento.",
  },
  portable: {
    title: "Ultraliviana y Portátil",
    intro: "Pensada para quienes trabajan o estudian en movimiento y necesitan un equipo liviano que rinda todo el día.",
  },
  business: {
    title: "Confiabilidad Empresarial",
    intro:
      "Línea corporativa reconocida por su durabilidad, ideal para trabajo de oficina, universidad y teletrabajo en jornadas largas.",
  },
  everyday: {
    title: "Ideal para el Día a Día",
    intro: "Perfecta para estudiar, trabajar desde casa, clases virtuales y entretenimiento, con la fluidez que se necesita a diario.",
  },
};

/** Alta gama si la línea es premium o el procesador es de la franja alta (i7 / Ryzen 7), como en tu ThinkPad E14 con i7. */
function pickHeadline(audience: Audience, cpuLabel: string | null): Headline {
  if (audience === "convertible") return "convertible";
  if (audience === "premium" || /\bi7\b|ryzen 7/i.test(cpuLabel ?? "")) return "highEnd";
  if (audience === "portable") return "portable";
  if (audience === "business") return "business";
  return "everyday";
}

// Bloque fijo de calidad, logística y software: mismo texto en toda publicación.
const QUALITY_BLOCK =
  "Cada uno de nuestros equipos pasa por un riguroso proceso de diagnóstico, mantenimiento técnico y pruebas de rendimiento antes de ser publicado. Entregamos hardware 100% funcional y listo para trabajar.";
const LOGISTICS_LINE = "* 🚚 Logística: Envíos a todo el Perú. (Entrega presencial disponible en la ciudad de Arequipa).";
const SOFTWARE_LINE =
  "* 💿 Software: Incluye Microsoft Office (Word, Excel, PowerPoint, etc.) y otros programas que necesites, previo aviso.";

// Corta el título en el primer token que ya es una spec, no una descripción
// del equipo: CPU ("i5-1135G7", "Ryzen 5"), RAM/storage ("16GB"), Windows, o
// el separador "|" que usan los vendedores que apilan specs con pipes. Lo que
// queda antes es "Marca + línea + modelo", para la línea de encabezado de la
// descripción — igual que armarías vos la ficha a mano, pero derivado del
// título real en vez de tipeado de nuevo.
// El sufijo de CPU Intel puede terminar en letra+dígito ("...1165G7"), no solo
// letras ("...1135U"): [a-z0-9]{0,3} cubre ambos en vez de solo [a-z]{0,2}.
// También corta en el tamaño de pantalla ("14\"", "15.6 in"), en lo que ya es
// ficha (FHD, Touch, Intel, AMD, Core) y en " - ", para que quede "Lenovo
// ThinkPad E14 Gen 2" y no "Lenovo ThinkPad E14 Gen 2 14\" FHD Intel Core".
const SPEC_START_RE =
  /\b(?:i[3579][\s-]?\d{3,5}[a-z0-9]{0,3}\b|ryzen\s*\d|\d{1,3}\s?gb\b|\d\s?tb\b|win(?:dows)?\s?1[01]\b|1[1-7](?:\.\d)?\s?(?:"|”|''|in\b|inch|-inch)|(?:fhd|uhd|qhd|hd\+?|touch(?:screen)?|intel|amd|core|laptop|notebook)\b)|@\s?\d|\||\s[-–—]\s|\(/i;

function extractModelLine(title: string): string {
  const match = title.match(SPEC_START_RE);
  const cut = match ? title.slice(0, match.index) : title;
  return cut.replace(/[-|,\s]+$/, "").trim() || title.trim();
}

const NO_CHARGER_RE = /\bno\s+(?:ac\s+)?(?:charger|power\s+adapter|adapter)\b|charger\s+not\s+included|sin\s+cargador/i;
const SCREEN_SIZE_ASPECT_RE = /screen\s*size/i;

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

/**
 * Línea de condición en mayúsculas para la descripción de venta. A propósito
 * no dice "SEMI NUEVA" ni nada por el estilo para todo lo usado: eso es un
 * juicio sobre una unidad puntual (raspones, uso real) que no sale de
 * ninguna columna de eBay, y prometerlo de más genera reclamos. Se deriva de
 * la condición que sí declaró el vendedor, y queda igual de editable en el
 * panel si para un equipo concreto sabés que amerita algo más.
 */
function conditionHeadline(condition: string | null): string {
  if (condition && /refurbished/i.test(condition)) return "REACONDICIONADO, EXCELENTE ESTADO";
  if (condition && /^new/i.test(condition)) return "NUEVO, SIN USO";
  return "USADO, BUEN ESTADO FUNCIONAL";
}

/**
 * Grado de condición para el campo `conditionGrade` de REVOLT-LAP: el valor
 * corto en inglés-mayúsculas que ya usa el catálogo en producción
 * ("REFURBISHED" en los productos existentes) — se sigue esa convención en
 * vez de inventar una nueva. Distinto de conditionHeadline, que es la frase
 * en español para el copy de venta.
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

/** Modelo exacto del procesador tal como lo escribió el vendedor: "Intel Core i7-1165G7", "AMD Ryzen 7 4700U". */
function exactCpuModel(text: string): string | null {
  const intel = text.match(/\b(i[3579])[\s-]?(\d{4,5}[a-z0-9]{0,3})\b/i);
  if (intel) return `Intel Core ${intel[1].toLowerCase()}-${intel[2].toUpperCase()}`;
  const amd = text.match(/\bryzen\s*([3579])\s*(?:pro\s*)?(\d{4}[a-z]{0,2})\b/i);
  if (amd) return `AMD Ryzen ${amd[1]} ${amd[2].toUpperCase()}`;
  return null;
}

/**
 * Gráficos integrados, solo cuando se puede afirmar: Iris Xe viene en los
 * i5/i7 de 11.ª y 12.ª de las series G7, U y P (no en todos los H), y Radeon
 * en los Ryzen con gráficos integrados de la serie U.
 */
function graphicsPhrase(model: string | null): string {
  if (!model) return "gráficos integrados";
  if (/i[57]-11\d{2}G7|i[57]-12\d{2}[UP]\b/i.test(model)) return "gráficos integrados fluidos gracias a la tecnología Iris Xe";
  if (/Ryzen \d \d{4}U/i.test(model)) return "gráficos integrados Radeon";
  return "gráficos integrados";
}

/** "Intel i7 11th gen" -> "Intel Core i7 de 11.ª generación" (para la frase, no para la ficha). */
function cpuInProse(cpuLabel: string | null): string | null {
  if (!cpuLabel) return null;
  const intel = cpuLabel.match(/^Intel i(\d) (\d{1,2})(?:st|nd|rd|th) gen$/i);
  if (intel) return `Intel Core i${intel[1]} de ${intel[2]}.ª generación`;
  const amd = cpuLabel.match(/^AMD Ryzen (\d) (\d{3,4})$/i);
  if (amd) return `AMD Ryzen ${amd[1]} de la serie ${amd[2]}`;
  return simplifyCpu(cpuLabel);
}

function cpuBenefit(cpuLabel: string | null): string {
  if (/\bi7\b/i.test(cpuLabel ?? "")) return "Rendimiento de nivel corporativo.";
  if (/ryzen 7/i.test(cpuLabel ?? "")) return "Potencia multinúcleo de alto nivel.";
  if (/ryzen 5/i.test(cpuLabel ?? "")) return "Rendimiento ágil y eficiente.";
  return "Equilibrio ideal entre potencia y eficiencia.";
}

function ramBenefit(ram: number): string {
  if (ram >= 32) return "Potencia de sobra para programación, edición y máquinas virtuales.";
  if (ram >= 16) return "Fluidez absoluta con múltiples aplicaciones en paralelo.";
  return "Suficiente para ofimática, navegación y clases virtuales.";
}

/** "Usado, buen estado funcional." — la misma condición de conditionHeadline, en tono de frase. */
function conditionSentence(condition: string | null): string {
  const headline = conditionHeadline(condition).toLowerCase();
  return `${headline.charAt(0).toUpperCase()}${headline.slice(1)}.`;
}

/** "14 in" / "14\"" -> "14 pulgadas", con Full HD y táctil solo si lo dice la publicación. */
function screenLine(screenSize: string | null, text: string): string | null {
  const size = screenSize?.match(/\d{2}(?:\.\d)?/)?.[0] ?? text.match(/\b(1[1-7](?:\.\d)?)\s?(?:"|”|''|in\b|inch|-inch|pulgadas)/i)?.[1];
  if (!size) return null;
  const fhd = /\b(?:fhd|full\s*hd|1920\s*x\s*1080|1080p)\b/i.test(text);
  const touch = /\btouch(?:screen)?\b|táctil/i.test(text);
  const details = [fhd ? "Full HD" : null, touch ? "táctil" : null].filter(Boolean).join(" ");
  return `* Pantalla: ${size} pulgadas${details ? ` ${details}` : ""} – Definición óptima para extensas jornadas de trabajo.`;
}

function buildDescription(input: {
  audience: Audience;
  modelLine: string;
  condition: string | null;
  cpuLabel: string | null;
  text: string;
  ram: number;
  storageGb: number;
  screenSize: string | null;
  batteryPct: number | null;
  hasCharger: boolean;
}): string {
  const headline = HEADLINE_COPY[pickHeadline(input.audience, input.cpuLabel)];
  const storage =
    input.storageGb >= 1000 ? `${Math.round(input.storageGb / 1000)}TB` : input.storageGb > 0 ? `${input.storageGb}GB` : null;

  const model = exactCpuModel(input.text);
  const ghz = input.text.match(/\b(\d\.\d{1,2})\s?ghz\b/i)?.[1];
  const prose = cpuInProse(input.cpuLabel);
  const cpuSentence = prose
    ? ` Esta laptop destaca por su procesador ${prose}${ghz ? ` a ${ghz}GHz` : ""}${model ? ` (${model})` : ""}, una arquitectura optimizada para la multitarea exigente, la ejecución de software pesado y ${graphicsPhrase(model)}.`
    : "";

  const specLines = [
    input.cpuLabel ? `* Procesador: ${simplifyCpu(input.cpuLabel)} – ${cpuBenefit(input.cpuLabel)}` : null,
    input.ram > 0 ? `* Memoria RAM: ${input.ram}GB – ${ramBenefit(input.ram)}` : null,
    storage
      ? `* Almacenamiento: ${storage} SSD – Unidad de estado sólido para un arranque inmediato${input.storageGb >= 1000 ? " y espacio de sobra" : ""}.`
      : null,
    screenLine(input.screenSize, input.text),
    input.batteryPct != null ? `* Batería: ${input.batteryPct}% de su capacidad original.` : null,
  ].filter((l): l is string => Boolean(l));

  const lines = [
    `🟦 ${headline.title}: ${input.modelLine}`,
    `${headline.intro}${cpuSentence}`,
    `🔹 Estado: ${conditionSentence(input.condition)}`,
    "🔹 Especificaciones técnicas:",
    "",
    ...specLines,
    "",
    "🔹 Control de calidad REVOLT:",
    QUALITY_BLOCK,
    "",
    input.hasCharger ? "* 📦 Accesorios: Incluye cargador." : "* 📦 Accesorios: Cargador no incluido (consultar).",
    LOGISTICS_LINE,
    SOFTWARE_LINE,
  ];
  return lines.join("\n");
}

/** Implementación por reglas. Ver el comentario de arriba del archivo. */
export const ruleBasedMarketingCopy: MarketingCopyGenerator = {
  generate(input: MarketingCopyInput): MarketingCopy {
    const audience = detectAudience(input.title, input.modelTiers);
    const brand = brandFromTitle(input.title) || "";
    const text = `${input.title} ${input.descriptionText}`;
    const ram = extractRamGb(text);
    const storageGb = extractStorageGb(text);
    const battery = extractBatteryPercent(text);
    const screenAspect = input.aspects.find((a) => SCREEN_SIZE_ASPECT_RE.test(a.name));

    return {
      title: buildTitle(brand, audience, ram, storageGb),
      description: buildDescription({
        audience,
        modelLine: extractModelLine(input.title),
        condition: input.condition,
        cpuLabel: input.cpuLabel,
        text,
        ram,
        storageGb,
        screenSize: screenAspect?.value ?? null,
        batteryPct: battery,
        hasCharger: !NO_CHARGER_RE.test(text),
      }),
    };
  },
};

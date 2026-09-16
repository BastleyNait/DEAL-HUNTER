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

// Bloque de marca fijo, mismo texto en toda publicación.
const STORE_URL = "https://revolt-laptops.vercel.app/";
const STORE_SIGNATURE = "SOMOS REVOLT — RENDIMIENTO SIN COMPROMISOS";

// Corta el título en el primer token que ya es una spec, no una descripción
// del equipo: CPU ("i5-1135G7", "Ryzen 5"), RAM/storage ("16GB"), Windows, o
// el separador "|" que usan los vendedores que apilan specs con pipes. Lo que
// queda antes es "Marca + línea + modelo", para la línea de encabezado de la
// descripción — igual que armarías vos la ficha a mano, pero derivado del
// título real en vez de tipeado de nuevo.
// El sufijo de CPU Intel puede terminar en letra+dígito ("...1165G7"), no solo
// letras ("...1135U"): [a-z0-9]{0,3} cubre ambos en vez de solo [a-z]{0,2}.
const SPEC_START_RE = /\b(?:i[3579][\s-]?\d{3,5}[a-z0-9]{0,3}\b|ryzen\s*\d|\d{1,3}\s?gb\b|\d\s?tb\b|win(?:dows)?\s?1[01]\b|@\s?\d|\|)/i;

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

function buildDescription(input: {
  audience: Audience;
  modelLine: string;
  condition: string | null;
  cpuSimplified: string | null;
  ram: number;
  storageGb: number;
  screenSize: string | null;
  batteryPct: number | null;
  hasCharger: boolean;
}): string {
  const storage =
    input.storageGb >= 1000 ? `${Math.round(input.storageGb / 1000)}TB` : input.storageGb > 0 ? `${input.storageGb}GB` : null;

  const specLines = [
    input.cpuSimplified ? `💻 Procesador: ${input.cpuSimplified}` : null,
    input.ram > 0 ? `🧠 Memoria RAM: ${input.ram}GB` : null,
    storage ? `💾 Almacenamiento: ${storage} SSD (arranque rápido)` : null,
    input.screenSize ? `🖥️ Pantalla: ${input.screenSize}` : null,
    input.batteryPct != null ? `🔋 Batería: ${input.batteryPct}% de su capacidad original` : null,
  ].filter((l): l is string => Boolean(l));

  // "Profesionalmente reacondicionado" es una afirmación sobre un proceso que
  // se hizo — solo se pone cuando el propio vendedor de eBay ya declaró la
  // publicación como reacondicionada. Para el resto, la frase más genérica
  // de "revisado antes de publicar" ya estaba y sigue siendo cierta siempre.
  const refurbLine =
    input.condition && /refurbished/i.test(input.condition)
      ? "🛡️ Profesionalmente reacondicionado."
      : "✅ Revisado y probado antes de publicar.";

  const lines = [
    AUDIENCE_COPY[input.audience].bullet,
    "",
    input.modelLine,
    conditionHeadline(input.condition),
    ...specLines,
    refurbLine,
    "🚚 Envíos a todo el Perú.",
    input.hasCharger ? "Incluye cargador." : "Sin cargador (revisar la publicación original).",
    "🛡️ Garantía de 6 meses por defectos de fábrica.",
    "",
    "Visitanos en",
    STORE_URL,
    "",
    STORE_SIGNATURE,
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
    const text = `${input.title} ${input.descriptionText}`;
    const ram = extractRamGb(text);
    const storageGb = extractStorageGb(text);
    const battery = extractBatteryPercent(text);
    const cpuSimplified = simplifyCpu(input.cpuLabel);
    const screenAspect = input.aspects.find((a) => SCREEN_SIZE_ASPECT_RE.test(a.name));

    return {
      title: buildTitle(brand, audience, ram, storageGb),
      description: buildDescription({
        audience,
        modelLine: extractModelLine(input.title),
        condition: input.condition,
        cpuSimplified,
        ram,
        storageGb,
        screenSize: screenAspect?.value ?? null,
        batteryPct: battery,
        hasCharger: !NO_CHARGER_RE.test(text),
      }),
    };
  },
};

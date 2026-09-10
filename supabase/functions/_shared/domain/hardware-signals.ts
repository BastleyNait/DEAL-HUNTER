// Extractores de señales de hardware desde texto libre (título + descripción).
// Centralizados acá porque los usan tanto las reglas de exclusión como el scoring,
// y no queremos dos regex ligeramente distintas divergiendo con el tiempo.

const BATTERY_PERCENT_RE = /batt(?:ery)?[^\d%]{0,15}(\d{1,3})\s?%/i;

/** Devuelve el % de batería mencionado en el texto, o null si no hay dato. */
export function extractBatteryPercent(text: string): number | null {
  const m = text.match(BATTERY_PERCENT_RE);
  if (!m) return null;
  const pct = Number(m[1]);
  if (Number.isNaN(pct) || pct > 100) return null;
  return pct;
}

const BATTERY_MENTION_RE = /batt(?:ery)?/i;

/** true si el texto menciona la batería de alguna forma (con o sin %/estado). */
export function mentionsBattery(text: string): boolean {
  return BATTERY_MENTION_RE.test(text);
}

// Nunca cruza una coma: evita mezclar "Cosmetic Grade B, Battery Grade D"
// (acá D es de batería, no B) con la instancia equivocada de "Grade X".
const BATTERY_GRADE_RE = /batt(?:ery)?[^\n,]{0,12}grade[ :]{0,2}\b([a-f])\b|grade[ :]{0,2}\b([a-f])\b[^\n,]{0,3}batt(?:ery)?/i;

/** Devuelve la letra (A-F, mayúscula) si el vendedor calificó la batería con un grado, o null. */
export function extractBatteryGrade(text: string): string | null {
  const m = text.match(BATTERY_GRADE_RE);
  if (!m) return null;
  return (m[1] ?? m[2]).toUpperCase();
}

// No sabemos la escala exacta de cada vendedor, pero A/B se asumen aceptables;
// C, D y F son las que pediste marcar para revisar a mano.
const GRADES_TO_REVIEW = new Set(["C", "D", "F"]);

export function needsBatteryGradeReview(grade: string | null): boolean {
  return grade !== null && GRADES_TO_REVIEW.has(grade);
}

const MIN_DESCRIPTION_LENGTH = 20;

/** true si el vendedor puso una descripción con contenido real (no vacía/boilerplate corta). */
export function hasMeaningfulDescription(descriptionText: string): boolean {
  return descriptionText.trim().length >= MIN_DESCRIPTION_LENGTH;
}

// Cubre las formas reales en que los vendedores anuncian que no lleva disco:
// "NO HD", "no hdd", "sin disco", "without ssd", "missing hard drive", etc.
// Ojo: "no hd" no matchea dentro de "no hdmi" por el \b final, y "no dvd drive"
// tampoco (exige que la palabra venga pegada al "no").
const MISSING_STORAGE_PHRASE_RE =
  /\b(?:no|without|missing|sin)\s*(?:hard\s*(?:drive|disk)|hdd|hd|ssd|nvme|m\.?2|storage|drive|disco(?:\s*duro)?|almacenamiento)\b/i;

export function mentionsNoStorage(text: string): boolean {
  return MISSING_STORAGE_PHRASE_RE.test(text);
}

/**
 * Huella para detectar republicaciones del mismo equipo: hay vendedores que
 * suben la misma laptop 10 veces cambiando solo un carácter del título
 * ("... NO HD", "... NO HD *", "... NO HD ~") para ocupar más lugar en la
 * búsqueda. Normalizar a solo letras y números las colapsa a una sola.
 */
export function listingFingerprint(title: string, price: number | null): string {
  const normalized = title
    .toLowerCase()
    // 13.3in / 13.3 inch / 13.3" son la misma medida escrita distinto, y es la
    // variación más común entre republicaciones del mismo equipo.
    .replace(/(\d)\s*(?:inches|inch|in)\b/g, "$1")
    .replace(/[^a-z0-9]/g, "");
  return `${normalized}|${Math.round(price ?? 0)}`;
}

const RAM_RE = /(\d{1,3})\s?gb\s*ram|ram\s*[:\-]?\s*(\d{1,3})\s?gb/i;

/** Devuelve los GB de RAM mencionados, o 0 si no se detecta. */
export function extractRamGb(text: string): number {
  const m = text.match(RAM_RE);
  const gb = m ? Number(m[1] ?? m[2]) : 0;
  return Number.isNaN(gb) ? 0 : gb;
}

const STORAGE_TB_RE = /\b(\d)\s?tb\b/i;
const STORAGE_GB_RE = /(\d{3,4})\s?gb\s*(ssd|hdd|nvme|storage)?/i;

/** Devuelve los GB de almacenamiento mencionados (1TB -> 1000), o 0 si no se detecta. */
export function extractStorageGb(text: string): number {
  const tbMatch = text.match(STORAGE_TB_RE);
  if (tbMatch) return Number(tbMatch[1]) * 1000;
  const gbMatch = text.match(STORAGE_GB_RE);
  const gb = gbMatch ? Number(gbMatch[1]) : 0;
  return Number.isNaN(gb) ? 0 : gb;
}

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

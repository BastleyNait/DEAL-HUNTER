import type { ListingDetail } from "./types.ts";
import { readSpecs } from "./listing-specs.ts";

/**
 * Piso de ficha técnica para todo lo que se busca: 16GB de RAM sí o sí y disco
 * de 256GB o más (512 va por delante en el puntaje). 8GB y 128GB no se miran.
 *
 * Solo descarta lo que se sabe: si la publicación no dice la RAM o el disco,
 * pasa (y en el pre-descarte, sin la descripción, se decide después).
 */
export const MIN_RAM_GB = 16;
// 240 y 250 son discos "de 256" con otra cuenta: entran.
export const MIN_STORAGE_GB = 240;

// La memoria de video no es RAM: "Quadro T550 4GB", "RTX 3050 4GB GDDR6".
const VRAM_RE =
  /\b(?:quadro|rtx|gtx|geforce|nvidia|radeon|mx\s?\d{3}|t(?:400|500|550|600|1000|1200|2000)|p(?:520|620|1000|2000|3200)|a(?:500|1000|2000|3000))\b[^,;|/()\n]{0,24}?\b\d{1,2}\s?gb\b|\b\d{1,2}\s?gb\s*(?:gddr\d\w*|vram|dedicated|graphics|video)\b/gi;
// "2x8GB" son 16GB.
const KIT_RE = /\b(\d)\s?x\s?(\d{1,2})\s?gb\b/gi;

function clean(text: string): string {
  return text.replace(VRAM_RE, " ").replace(KIT_RE, (_m, n, gb) => `${Number(n) * Number(gb)}GB RAM`);
}

/** El motivo de descarte si la RAM o el disco conocidos no alcanzan; null si pasa. */
export function lowSpecReason(listing: ListingDetail): string | null {
  const specs = readSpecs({ ...listing, title: clean(listing.title), descriptionText: clean(listing.descriptionText ?? "") });
  if (specs.ramGb > 0 && specs.ramGb < MIN_RAM_GB) return `ram_${specs.ramGb}gb`;
  if (specs.storageGb > 0 && specs.storageGb < MIN_STORAGE_GB) return `storage_${specs.storageGb}gb`;
  return null;
}

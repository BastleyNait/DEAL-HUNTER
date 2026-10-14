import type { ListingAspect, ListingDetail } from "./types.ts";
import { extractRamGb, extractStorageGb } from "./hardware-signals.ts";

/**
 * RAM y disco de una publicación, leídos con el mismo criterio para todos los
 * tipos que dependen de ellos (OFERTA URGENTE, la excepción de 16GB + 1TB).
 */
export interface ListingSpecs {
  /** GB de RAM, o 0 si no se pudo leer. */
  ramGb: number;
  /** GB de almacenamiento (1TB = 1000), o 0 si no se pudo leer. */
  storageGb: number;
  /** Dice SSD / NVMe / M.2 en algún lado. */
  isSsd: boolean;
  /** Habla de un disco rígido (HDD). */
  mentionsHdd: boolean;
  /** Título + descripción + item specifics, para los filtros de texto. */
  text: string;
}

// Que sea un disco de estado sólido, no solo "512GB": una laptop de 1TB HDD no
// es lo que se busca aunque la capacidad sobre.
const SSD_RE = /\b(?:ssd|nvme|m\.?2|solid[\s-]*state)\b/i;
const HDD_RE = /\b(?:hdd|hard\s*(?:disk|drive))\b/i;

const RAM_ASPECT_RE = /\b(?:ram|memory)\b/i;
const STORAGE_ASPECT_RE = /\b(?:ssd|storage|hard\s*drive)\b/i;

/** GB de un item specific ("RAM Size: 16 GB", "SSD Capacity: 1 TB"), o 0 si no hay o no se entiende. */
function aspectGb(aspects: ListingAspect[], nameRe: RegExp): number {
  for (const aspect of aspects) {
    if (!nameRe.test(aspect.name)) continue;
    const m = aspect.value.match(/(\d+(?:\.\d+)?)\s*(tb|gb)/i);
    if (!m) continue;
    const gb = Number(m[1]) * (m[2].toLowerCase() === "tb" ? 1000 : 1);
    if (gb > 0) return gb;
  }
  return 0;
}

/** Primer valor que se pudo leer, en el orden de confianza: título, item specifics, descripción. */
function firstKnown(...values: number[]): number {
  return values.find((v) => v > 0) ?? 0;
}

export function readSpecs(listing: ListingDetail): ListingSpecs {
  // Los item specifics ya vienen dentro de descriptionText cuando la
  // publicación sale de eBay; se suman igual por si llegan por separado.
  const aspectsText = listing.aspects.map((a) => `${a.name}: ${a.value}`).join(". ");
  const text = `${listing.title}. ${listing.descriptionText}. ${aspectsText}`;
  return {
    ramGb: firstKnown(extractRamGb(listing.title), aspectGb(listing.aspects, RAM_ASPECT_RE), extractRamGb(listing.descriptionText)),
    storageGb: firstKnown(
      extractStorageGb(listing.title),
      aspectGb(listing.aspects, STORAGE_ASPECT_RE),
      extractStorageGb(listing.descriptionText),
    ),
    isSsd: SSD_RE.test(text),
    mentionsHdd: HDD_RE.test(text),
    text,
  };
}

/**
 * ¿Alcanzan la RAM y el disco (SSD)? `lenient` es para el pre-descarte, que
 * solo ve el título y un resumen: lo que todavía no se sabe (RAM o disco sin
 * mencionar, tipo de disco sin decir) no descarta, para que la publicación
 * llegue a la consulta de detalle y se decida con los datos completos. Lo que
 * sí se sabe y no alcanza, descarta.
 */
export function meetsSpecs(
  specs: ListingSpecs,
  min: { ramGb: number; storageGb: number },
  lenient: boolean,
): boolean {
  if (specs.ramGb === 0 ? !lenient : specs.ramGb < min.ramGb) return false;
  if (specs.storageGb === 0 ? !lenient : specs.storageGb < min.storageGb) return false;
  if (!specs.isSsd && specs.mentionsHdd) return false;
  if (!specs.isSsd && !lenient) return false;
  return true;
}

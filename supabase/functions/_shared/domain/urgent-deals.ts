import type { ListingAspect, ListingDetail, SearchConfig } from "./types.ts";
import { createCpuMatcher } from "../cpu/cpu-matcher.ts";
import { extractRamGb, extractStorageGb, mentionsOutsideContext } from "./hardware-signals.ts";

export interface UrgentDealMatcher {
  /**
   * true si la publicación es OFERTA URGENTE: compra directa, bajo el tope,
   * con la CPU, la RAM y el disco pedidos y sin hablar de problemas.
   *
   * `lenient` es para el pre-descarte, que solo ve el título y un resumen: lo
   * que todavía no se puede saber (la RAM o el disco sin mencionar) no
   * descarta, para que la publicación llegue a la consulta de detalle y se
   * decida con los datos completos. Lo que sí se sabe y no alcanza, descarta.
   */
  isUrgent(listing: ListingDetail, options?: { lenient?: boolean }): boolean;
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

export function createUrgentDealMatcher(config: SearchConfig): UrgentDealMatcher {
  const urgent = config.urgentDeal;
  const cpuMatcher = createCpuMatcher(config);
  const cpuLabels = new Set(urgent.cpuLabels);
  const issueRe = new RegExp(urgent.issuePattern, urgent.issueFlags);
  const issueContextRe = new RegExp(urgent.issueIgnoreContextPattern, "i");

  return {
    isUrgent(listing, options) {
      const lenient = options?.lenient ?? false;

      if (listing.price == null || listing.price >= urgent.maxPriceUsd) return false;
      if (listing.buyingOptions.includes("AUCTION")) return false;

      // Misma lectura de CPU que la selección de candidatos (título y, si no,
      // el resumen): así este criterio y el de la búsqueda no se contradicen.
      const cpu = cpuMatcher.match(listing.title) ?? cpuMatcher.match(`${listing.title} ${listing.shortDescription}`);
      if (!cpu || !cpuLabels.has(cpu.label)) return false;

      // Los item specifics ya vienen dentro de descriptionText cuando la
      // publicación sale de eBay; se suman igual por si llegan por separado.
      const aspectsText = listing.aspects.map((a) => `${a.name}: ${a.value}`).join(". ");
      const text = `${listing.title}. ${listing.descriptionText}. ${aspectsText}`;

      const ram = firstKnown(
        extractRamGb(listing.title),
        aspectGb(listing.aspects, RAM_ASPECT_RE),
        extractRamGb(listing.descriptionText),
      );
      if (ram === 0 ? !lenient : ram < urgent.minRamGb) return false;

      const storage = firstKnown(
        extractStorageGb(listing.title),
        aspectGb(listing.aspects, STORAGE_ASPECT_RE),
        extractStorageGb(listing.descriptionText),
      );
      if (storage === 0 ? !lenient : storage < urgent.minStorageGb) return false;

      const isSsd = SSD_RE.test(text);
      if (!isSsd && HDD_RE.test(text)) return false;
      if (!isSsd && !lenient) return false;

      return !mentionsOutsideContext(text, issueRe, { ignoreNegated: true, ignoreContext: issueContextRe });
    },
  };
}

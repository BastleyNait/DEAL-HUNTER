import type { GpuPriorityConfig, ListingDetail, ListingSummary } from "./types.ts";
import { detectDedicatedGpu, isDesignGrade, type DedicatedGpu } from "./dedicated-gpu.ts";

/**
 * Prioridad de las laptops con gráfica dedicada (ver GpuPriorityConfig).
 * Funciona con lo que haya: en la búsqueda solo está el título y el resumen; en
 * el detalle también la descripción y los datos del producto (item specifics).
 */

/** La gráfica dedicada de la publicación, o null si es integrada o no la nombra. */
export function gpuOf(listing: ListingDetail | ListingSummary): DedicatedGpu | null {
  const detail = listing as Partial<ListingDetail>;
  const text = [listing.title, listing.shortDescription, detail.descriptionText].filter(Boolean).join(". ");
  const named = detectDedicatedGpu(text, detail.aspects ?? []);
  if (named) return named;

  // "... 512GB T1000": la Quadro sin "Quadro" delante. Solo en el título, donde
  // es la gráfica; en una descripción larga podría ser cualquier cosa.
  const bare = listing.title.match(BARE_QUADRO_RE);
  if (bare) return { name: `NVIDIA Quadro ${bare[1].toUpperCase()}`, vramGb: 4, professional: true };

  // Si los datos del producto dicen que la gráfica es integrada (una Precision
  // 5540 con "GPU: Intel UHD Graphics 630"), el modelo no alcanza.
  const integrated = (detail.aspects ?? []).some(
    (a) => /gpu|graphics/i.test(a.name) && /intel|uhd|iris|integrated|radeon\s+graphics|vega/i.test(a.value),
  );
  if (integrated) return null;

  // Muchos vendedores titulan "ThinkPad P15v ... NVIDIA" sin decir cuál: estos
  // modelos siempre traen gráfica profesional, así que cuentan igual. Solo
  // sirve para priorizar; el texto de las publicaciones nuestras no la nombra.
  return WORKSTATION_MODEL_RE.test(listing.title)
    ? { name: "NVIDIA Quadro/RTX (según el modelo)", vramGb: null, professional: true }
    : null;
}

// Quadro de 4 dígitos (ningún modelo de laptop se llama así) y P600/P620. Las
// de 3 dígitos tipo T500/T550 chocan con ThinkPad viejas: esas no.
const BARE_QUADRO_RE = /\b((?:t[12]|p[1-5])[02]00|p6[02]0)\b/i;

const WORKSTATION_MODEL_RE = /\bthinkpad\s+p(?:15v|1|17|50|51|52|53|72|73)\b|\bp15v\b|\bprecision\s+[57]\d{3}\b/i;

/** Puntos que suma al puntaje (0 si no tiene gráfica dedicada). */
export function gpuScoreBonus(gpu: DedicatedGpu | null, config: GpuPriorityConfig): number {
  if (!gpu) return 0;
  return isDesignGrade(gpu) ? config.designGradeBonus : config.otherBonus;
}

/** "NVIDIA Quadro P620 4GB": lo que se guarda y se muestra. */
export function gpuLabel(gpu: DedicatedGpu | null): string | null {
  if (!gpu) return null;
  return gpu.vramGb ? `${gpu.name} ${gpu.vramGb}GB` : gpu.name;
}

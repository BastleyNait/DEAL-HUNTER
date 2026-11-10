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

  // Muchos vendedores titulan "ThinkPad P15v ... NVIDIA" sin decir cuál: estos
  // modelos siempre traen gráfica profesional, así que cuentan igual. Solo
  // sirve para priorizar; el texto de las publicaciones nuestras no la nombra.
  return WORKSTATION_MODEL_RE.test(listing.title)
    ? { name: "NVIDIA Quadro/RTX (según el modelo)", vramGb: null, professional: true }
    : null;
}

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

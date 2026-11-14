import type { ListingDetail, ListingSummary, SearchConfig } from "./types.ts";
import type { DedicatedGpu } from "./dedicated-gpu.ts";
import { gpuOf } from "./gpu-priority.ts";

/**
 * ESPECIAL GPU (ver GpuSpecialConfig): gráfica buena para diseño, a hasta
 * config.gpuSpecial.maxPriceUsd aunque pase los topes generales.
 *
 * "Buena" = la Quadro P620 de la P15v (o la P600, casi igual) o mejor, de 2017 en adelante. Queda
 * afuera lo viejo o chico aunque sea profesional (Quadro K/M, P520, P500,
 * MX, GTX 1050 de 2GB): a $300 eso no se vende como equipo de diseño.
 */
const STRONG_GPU_RE = new RegExp(
  [
    String.raw`quadro (?:p(?:6\d\d|[1-5]\d{3})|t\d{3,4}|rtx \d{4})`, // P620..P5200, T500..T2000, Quadro RTX 3000+
    String.raw`nvidia t\d{3,4}`,
    String.raw`rtx a\d{3,4}`, // RTX A500..A5500
    String.raw`geforce gtx (?:1050\s*ti|106\d|107\d|108\d|16\d\d)`,
    String.raw`geforce rtx \d{4}`, // 20xx, 30xx, 40xx
    String.raw`radeon pro (?:wx (?:3[1-9]\d{2}|[4-9]\d{3})|[5-9]\d{3}m?)`,
    String.raw`radeon rx (?:5[5-9]\d{2}|6\d{3}|7\d{3})`,
  ].join("|"),
  "i",
);

/**
 * Estaciones de trabajo que siempre traen una gráfica buena aunque el título
 * no la nombre: ThinkPad P15v/P53/P52/P1/P17 y Precision 55x0/75x0/77x0 de
 * 2018 en adelante. Las Precision viejas (7510, 5510) traen Quadro M.
 */
const RECENT_WORKSTATION_RE =
  /\bthinkpad\s+p(?:15v?|17|53|52|1)\b|\bp15v\b|\bprecision\s+(?:55[3-7]0|75[3-7]0|77[3-7]0|76[3-7]0)\b/i;

export function isStrongGpu(gpu: DedicatedGpu | null): boolean {
  return gpu !== null && STRONG_GPU_RE.test(gpu.name);
}

export function isGpuSpecial(listing: ListingDetail | ListingSummary, config: SearchConfig): boolean {
  if (listing.price == null || listing.price > config.gpuSpecial.maxPriceUsd) return false;
  const gpu = gpuOf(listing);
  if (isStrongGpu(gpu)) return true;
  // Sin nombre de gráfica: vale solo por el modelo.
  return gpu !== null && gpu.name.includes("según el modelo") && RECENT_WORKSTATION_RE.test(listing.title);
}

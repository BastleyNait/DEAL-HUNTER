import type { ListingAspect } from "./types.ts";

/**
 * Tarjeta gráfica dedicada de una laptop: cambia para quién es el equipo. Con
 * una Quadro, una RTX A o una GeForce de 4GB, la laptop sirve para AutoCAD,
 * Revit, SolidWorks, render y edición de video, y eso tiene que decirlo la
 * publicación (caso real: una ThinkPad P15v con Quadro P620 salía descrita
 * como laptop de oficina).
 */
export interface DedicatedGpu {
  /** "NVIDIA Quadro P620", "NVIDIA RTX A2000", "NVIDIA GeForce GTX 1650", "AMD Radeon Pro WX 3200". */
  name: string;
  /** Memoria de video en GB, o null si no se sabe. */
  vramGb: number | null;
  /** Línea profesional (Quadro, RTX A, Radeon Pro): certificada para software de CAD. */
  professional: boolean;
}

// Solo nombres que identifican una gráfica dedicada. "Intel UHD", "Iris Xe" o
// "AMD Radeon Graphics" a secas son integradas y no matchean. "T14"/"P15v" son
// modelos de ThinkPad: por eso las Quadro de la serie T/P piden "Quadro" o
// "NVIDIA" delante.
const GPU_PATTERNS: { re: RegExp; build: (m: RegExpMatchArray) => Omit<DedicatedGpu, "vramGb"> }[] = [
  {
    re: /\b(?:nvidia\s+)?quadro\s+(?:rtx\s+)?((?:[ptmk]|rtx\s*)\d{3,4}m?)\b/i,
    build: (m) => ({ name: `NVIDIA Quadro ${m[1].toUpperCase().replace(/\s+/g, " ")}`, professional: true }),
  },
  { re: /\b(?:nvidia\s+)?rtx\s*(a\d{3,4})\b/i, build: (m) => ({ name: `NVIDIA RTX ${m[1].toUpperCase()}`, professional: true }) },
  { re: /\bnvidia\s+(t\d{3,4})\b/i, build: (m) => ({ name: `NVIDIA ${m[1].toUpperCase()}`, professional: true }) },
  {
    re: /\b(?:nvidia\s+)?(?:geforce\s+)?((?:gtx|rtx)\s*\d{4}(?:\s*ti)?)\b/i,
    build: (m) => ({ name: `NVIDIA GeForce ${m[1].toUpperCase().replace(/(GTX|RTX)\s*/, "$1 ")}`, professional: false }),
  },
  { re: /\b(?:nvidia\s+)?(?:geforce\s+)?(mx\s*\d{3})\b/i, build: (m) => ({ name: `NVIDIA GeForce ${m[1].toUpperCase().replace(/MX\s*/, "MX")}`, professional: false }) },
  {
    re: /\bradeon\s+pro\s+(wx\s*\d{4}|\d{4}m?)\b/i,
    build: (m) => ({ name: `AMD Radeon Pro ${m[1].toUpperCase().replace(/WX\s*/, "WX ")}`, professional: true }),
  },
  { re: /\bradeon\s+(rx\s*\d{3,4}m?)\b/i, build: (m) => ({ name: `AMD Radeon ${m[1].toUpperCase().replace(/RX\s*/, "RX ")}`, professional: false }) },
];

// Memoria de video típica en laptops, para cuando la publicación no la dice.
// Solo modelos que en laptop vienen casi siempre con esa memoria.
const TYPICAL_VRAM_GB: Record<string, number> = {
  P520: 2, P620: 4, P1000: 4, P2000: 4, T500: 4, T550: 4, T600: 4, T1000: 4, T1200: 4, T2000: 4,
  A500: 4, A1000: 4, A2000: 4, "GTX 1650": 4, "GTX 1650 TI": 4, "GTX 1660 TI": 6, "RTX 2050": 4, "RTX 3050": 4,
  "RTX 3060": 6, "RTX 3070": 8, MX250: 2, MX330: 2, MX350: 2, MX450: 2, MX550: 2, "WX 3200": 4,
};

const VRAM_RE = /(\d{1,2})\s?gb\s*(?:of\s+)?(?:gddr\d\w*|vram|dedicated|video|graphics|gpu)\b|(?:gddr\d\w*|vram)\D{0,8}(\d{1,2})\s?gb\b/i;

export function detectDedicatedGpu(text: string, aspects: ListingAspect[] = []): DedicatedGpu | null {
  const aspectText = aspects
    .filter((a) => /gpu|graphics|video/i.test(a.name))
    .map((a) => `${a.name}: ${a.value}`)
    .join(". ");
  const source = `${aspectText}. ${text}`;

  for (const { re, build } of GPU_PATTERNS) {
    const m = source.match(re);
    if (!m) continue;
    const gpu = build(m);
    // La memoria: la que diga cerca del nombre de la gráfica; si no, la típica del modelo.
    const near = source.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 60);
    const said = near.match(VRAM_RE) ?? source.match(VRAM_RE);
    const saidGb = said ? Number(said[1] ?? said[2]) : null;
    const key = gpu.name.replace(/^NVIDIA (?:Quadro |RTX |GeForce )?|^AMD Radeon (?:Pro )?/i, "").toUpperCase();
    const vramGb = saidGb && saidGb <= 24 ? saidGb : (TYPICAL_VRAM_GB[key] ?? null);
    return { ...gpu, vramGb };
  }
  return null;
}

/** ¿Alcanza para venderla como equipo de diseño / AutoCAD? Profesional, o 4GB o más. */
export function isDesignGrade(gpu: DedicatedGpu | null): gpu is DedicatedGpu {
  return gpu !== null && (gpu.professional || (gpu.vramGb ?? 0) >= 4);
}

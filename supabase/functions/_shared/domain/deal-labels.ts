import type { EvaluatedDeal } from "./types.ts";

/**
 * ÚNICA fuente de los nombres de las ofertas (Telegram, el resumen y, copiados
 * a mano, el dashboard: DEAL WEB/src/domain/dealLabels.ts).
 *
 * Una oferta puede ser varias cosas a la vez, así que se separan dos papeles:
 *  - el ENCABEZADO: la etiqueta de más jerarquía, la que dice qué hacer ahora;
 *  - los CHIPS: todo lo demás que también es cierto, para no perder datos.
 *
 * Jerarquía de encabezado, de mayor a menor:
 *   💰 OFERTA URGENTE   la combinación que se compra sin pensarlo
 *   ⏰ SUBASTA          el aviso es porque está por cerrar
 *   🎮 GPU DEDICADA     gráfica de diseño: el mejor margen hasta ahora
 *   🔄 2 EN 1           el tipo especial que se busca a propósito
 *   🚨 OFERTAZA         puntaje 80+, o 16GB+ a $130 o menos con 70+ (ver cheapGreatDeal)
 *   🔥 OFERTA           cualquier otra que pasó el filtro
 * "⭐ CPU prioritaria" nunca encabeza: es una propiedad, va como chip.
 */
export type DealLabelId = "urgent" | "auction" | "gpu" | "special" | "great" | "priority";

export interface DealLabel {
  id: DealLabelId;
  emoji: string;
  /** Texto del encabezado ("OFERTA URGENTE"). */
  headline: string;
  /** Texto corto cuando va como chip ("URGENTE"). */
  chip: string;
}

const LABELS: Record<DealLabelId, DealLabel> = {
  urgent: { id: "urgent", emoji: "💰", headline: "OFERTA URGENTE", chip: "URGENTE" },
  auction: { id: "auction", emoji: "⏰", headline: "SUBASTA POR CERRAR", chip: "SUBASTA" },
  gpu: { id: "gpu", emoji: "🎮", headline: "GPU DEDICADA", chip: "GPU" },
  special: { id: "special", emoji: "🔄", headline: "OFERTA 2 EN 1", chip: "2 EN 1" },
  great: { id: "great", emoji: "🚨", headline: "OFERTAZA", chip: "OFERTAZA" },
  priority: { id: "priority", emoji: "⭐", headline: "CPU PRIORITARIA", chip: "CPU prioritaria" },
};

/** Orden de jerarquía: el primero que aplica es el encabezado. "priority" no encabeza. */
const HEADLINE_ORDER: DealLabelId[] = ["urgent", "auction", "gpu", "special", "great"];
/** Orden en que se listan los chips. */
const CHIP_ORDER: DealLabelId[] = ["urgent", "gpu", "special", "great", "priority", "auction"];

type LabelInput = Pick<
  EvaluatedDeal,
  "isUrgent" | "isAuction" | "isGpuDesign" | "gpu" | "specialLabel" | "specialDemoted" | "isGreatDeal" | "isPriority"
>;

/** Qué etiquetas le tocan a la oferta (sin orden). */
export function appliedLabels(deal: LabelInput): Set<DealLabelId> {
  const set = new Set<DealLabelId>();
  if (deal.isUrgent) set.add("urgent");
  if (deal.isAuction) set.add("auction");
  // Cualquier gráfica dedicada es un chip; solo la de diseño encabeza.
  if (deal.gpu) set.add("gpu");
  // Una 2 en 1 de baja prioridad (Dell) que igual llegó al aviso es una oferta normal.
  if (deal.specialLabel && !deal.specialDemoted) set.add("special");
  // Una subasta nunca es ofertaza: el precio final es desconocido.
  if (deal.isGreatDeal && !deal.isAuction) set.add("great");
  if (deal.isPriority) set.add("priority");
  return set;
}

export interface DealLabelling {
  /** null = oferta común (encabezado "🔥 OFERTA"). */
  headline: DealLabel | null;
  /** Todo lo demás que aplica, sin repetir el encabezado. */
  chips: DealLabel[];
}

export function labelDeal(deal: LabelInput): DealLabelling {
  const applied = appliedLabels(deal);
  const headlineId = HEADLINE_ORDER.find((id) => applied.has(id) && (id !== "gpu" || deal.isGpuDesign)) ?? null;
  const chips = CHIP_ORDER.filter((id) => applied.has(id) && id !== headlineId).map((id) => LABELS[id]);
  return { headline: headlineId ? LABELS[headlineId] : null, chips };
}

export const PLAIN_HEADLINE = { emoji: "🔥", headline: "OFERTA" };

/** "💰 URGENTE · 🎮 GPU · ⭐ CPU prioritaria" (vacío si no hay nada). */
export function chipsText(labels: DealLabel[]): string {
  return labels.map((l) => `${l.emoji} ${l.chip}`).join(" · ");
}

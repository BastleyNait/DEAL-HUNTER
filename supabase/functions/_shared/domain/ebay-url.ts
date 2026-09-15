/**
 * Saca el itemId de la Browse API a partir de lo único que un comprador tiene
 * a mano: el link de la publicación. Cubre las formas reales que trae eBay
 * ("/itm/206488626853", "/itm/titulo-largo/206488626853", con o sin query
 * string) y también un itemId ya en formato Browse API (v1|...|0), por si se
 * pega el link que ya guarda el propio dashboard.
 *
 * El "|0" al final asume publicación sin variaciones (sin talles/colores),
 * que es el caso de toda laptop usada. Con variaciones el id real lleva el
 * epid en vez de "0" y esto no lo resuelve — no hay forma de adivinarlo desde
 * la URL sola.
 */
export function parseEbayItemId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^v1\|\d+\|\d+$/.test(trimmed)) return trimmed;

  let path: string;
  try {
    path = new URL(trimmed).pathname;
  } catch {
    // No es una URL completa — probá igual como si el texto trajera el id.
    path = trimmed;
  }

  const match = path.match(/(\d{9,13})(?:[/?#]|$)/);
  if (!match) return null;
  return `v1|${match[1]}|0`;
}

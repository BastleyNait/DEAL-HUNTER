/**
 * La descripción de REVOLT-LAP se guarda como HTML (el editor del admin) o,
 * en productos que nunca se editaron, como el texto plano que mandamos al
 * publicar. Facebook Marketplace solo acepta texto: esto la aplana
 * conservando la estructura que se ve en la tienda (párrafos separados por
 * una línea en blanco, saltos de línea y viñetas).
 */

const HTML_TAG = /<\/?(p|br|strong|b|em|i|u|s|h[1-6]|ul|ol|li|blockquote|a|hr|div|span)\b[^>]*>/i;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

export function storeDescriptionToText(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  if (!HTML_TAG.test(value)) return value.replace(/\r\n?/g, "\n").trim();

  // Numeración de <ol>: cada <li> de una lista ordenada lleva su número.
  let html = value.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, items: string) => {
    let n = 0;
    return items.replace(/<li\b[^>]*>/gi, () => `\n${++n}. `);
  });

  html = html
    .replace(/<li\b[^>]*>/gi, "\n• ")
    // Un <p> dentro de un <li> (así anida TipTap) no abre párrafo nuevo.
    .replace(/(\n(?:• |\d+\. ))\s*<p\b[^>]*>/gi, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<hr\s*\/?>/gi, "\n\n")
    .replace(/<\/(p|h[1-6]|blockquote|div|ul|ol)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  return decodeEntities(html)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    // Las viñetas de una lista van juntas, sin línea en blanco entre ellas.
    .replace(/\n{2,}(?=(?:• |\d+\. ))/g, (gap, offset: number, all: string) => {
      const before = all.slice(0, offset).split("\n").pop() ?? "";
      return /^(• |\d+\. )/.test(before) ? "\n" : "\n\n";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Facebook corta el título en 100 caracteres: mejor cortarlo en una palabra. */
export function marketplaceTitle(name: string, max = 100): string {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:—-]+$/, "");
}

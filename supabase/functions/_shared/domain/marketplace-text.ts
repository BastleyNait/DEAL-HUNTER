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

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "Etiqueta: resto" con la etiqueta en negrita (si hay una etiqueta corta antes de los dos puntos). */
function labelled(text: string): string {
  const match = /^([^:]{1,48}:)(\s*)([\s\S]*)$/.exec(text);
  if (!match) return escapeHtml(text);
  return `<strong>${escapeHtml(match[1])}</strong>${match[3] ? " " + escapeHtml(match[3]) : ""}`;
}

const BULLET = /^(?:[*•\-–]\s+|\d+[.)]\s+)/;
const SECTION = /^🔹/u;
const HEADLINE = /^🟦/u;

/**
 * El texto de marketing (marketing-copy.ts) como HTML para la tienda: título
 * 🟦 y secciones 🔹 como encabezados, "Etiqueta: valor" con la etiqueta en
 * negrita y las viñetas como lista. Solo usa etiquetas que el editor del
 * admin conoce (h3, p, strong, ul, li), así que se puede seguir editando sin
 * que se pierda nada. Los emojis y los dos puntos se quedan: al aplanarlo con
 * storeDescriptionToText para Facebook sale el mismo texto de antes.
 * Un texto escrito a mano fuera de la plantilla queda como párrafos.
 */
export function marketingTextToHtml(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trim());
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.join("")}</ul>`);
    list = [];
  };

  for (const line of lines) {
    if (!line) {
      flush();
      continue;
    }
    if (BULLET.test(line)) {
      list.push(`<li><p>${labelled(line.replace(BULLET, ""))}</p></li>`);
      continue;
    }
    flush();
    if (HEADLINE.test(line)) out.push(`<h3>${escapeHtml(line)}</h3>`);
    else if (SECTION.test(line) && /:\s*$/.test(line)) out.push(`<h3>${escapeHtml(line)}</h3>`);
    else if (SECTION.test(line)) out.push(`<p>${labelled(line)}</p>`);
    else out.push(`<p>${escapeHtml(line)}</p>`);
  }
  flush();
  return out.join("");
}

/**
 * Ya tiene formato (encabezados o negritas): no hace falta convertirla. Una
 * lista sola no cuenta: así queda el texto plano que la tienda convirtió.
 */
export function isRichDescription(html: string | null | undefined): boolean {
  return /<(h[1-6]|strong|b)\b/i.test(html ?? "");
}

export const STORE_LINK_PREFIX = "🛒 Mira fotos y detalles en";

/**
 * Texto para Facebook con el enlace de la tienda al final. Si ya traía un
 * enlace (el texto guardado de una sincronización anterior) se reemplaza, no
 * se duplica.
 */
export function withStoreLink(text: string, url: string): string {
  const body = text
    .split("\n")
    .filter((line) => !line.startsWith(STORE_LINK_PREFIX))
    .join("\n")
    .trim();
  return `${body}\n\n${STORE_LINK_PREFIX}: ${url}`;
}

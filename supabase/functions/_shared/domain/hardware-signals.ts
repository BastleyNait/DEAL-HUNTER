// Extractores de señales de hardware desde texto libre (título + descripción).
// Centralizados acá porque los usan tanto las reglas de exclusión como el scoring,
// y no queremos dos regex ligeramente distintas divergiendo con el tiempo.

const BATTERY_PERCENT_RE = /batt(?:ery)?[^\d%]{0,15}(\d{1,3})\s?%/i;

/** Devuelve el % de batería mencionado en el texto, o null si no hay dato. */
export function extractBatteryPercent(text: string): number | null {
  const m = text.match(BATTERY_PERCENT_RE);
  if (!m) return null;
  const pct = Number(m[1]);
  if (Number.isNaN(pct) || pct > 100) return null;
  return pct;
}

const BATTERY_MENTION_RE = /batt(?:ery)?/i;

/** true si el texto menciona la batería de alguna forma (con o sin %/estado). */
export function mentionsBattery(text: string): boolean {
  return BATTERY_MENTION_RE.test(text);
}

// Nunca cruza una coma: evita mezclar "Cosmetic Grade B, Battery Grade D"
// (acá D es de batería, no B) con la instancia equivocada de "Grade X".
const BATTERY_GRADE_RE = /batt(?:ery)?[^\n,]{0,12}grade[ :]{0,2}\b([a-f])\b|grade[ :]{0,2}\b([a-f])\b[^\n,]{0,3}batt(?:ery)?/i;

/** Devuelve la letra (A-F, mayúscula) si el vendedor calificó la batería con un grado, o null. */
export function extractBatteryGrade(text: string): string | null {
  const m = text.match(BATTERY_GRADE_RE);
  if (!m) return null;
  return (m[1] ?? m[2]).toUpperCase();
}

// No sabemos la escala exacta de cada vendedor, pero A/B se asumen aceptables;
// C, D y F son las que pediste marcar para revisar a mano.
const GRADES_TO_REVIEW = new Set(["C", "D", "F"]);

export function needsBatteryGradeReview(grade: string | null): boolean {
  return grade !== null && GRADES_TO_REVIEW.has(grade);
}

/**
 * Daño declarado por el vendedor. Es regla de código y no un patrón de config
 * porque necesita dos señales: que aparezca la frase Y que no venga negada.
 * Sin eso se descartan máquinas sanas, porque las descripciones están llenas de
 * frases como "✅ No Water Damage", "won't be any significant damage" o
 * "does not cover cosmetic damage" (términos de garantía).
 *
 * "cosmetic damage" a secas queda afuera a propósito: rayones y marcas de uso
 * son la línea base de una laptop corporativa usada y no frenan la reventa.
 * Lo que descarta es daño estructural o funcional.
 */
const DAMAGE_PHRASE_RE =
  /(?:have|has|with|showing)\s+damage|(?:severe|significant|major|structural|chassis|frame|physical|water|screen|display|lcd)\s+(?:\w+\s+){0,2}damage|breakage|split\s+hinge|display\s+(?:blemish|spot)|unable\s+to\s+close/gi;

// Negación en la misma oración, hasta 25 caracteres antes de la frase.
const NEGATION_BEFORE_RE =
  // "No issues" / "No problems" niegan lo suyo, no lo que viene después: en
  // "Keyboard: Good - No issues Power Supply: Included" el cargador sí viene.
  /\b(?:no|not|never|nothing|none|without|won'?t|doesn'?t|don'?t|free\s+of|free\s+from|excluding|except)\b(?!\s+(?:issues?|problems?)\b)[^.!?]{0,25}$/i;

export function declaresDamage(text: string): boolean {
  DAMAGE_PHRASE_RE.lastIndex = 0;
  for (const match of text.matchAll(DAMAGE_PHRASE_RE)) {
    const before = text.slice(0, match.index);
    if (!NEGATION_BEFORE_RE.test(before)) return true;
  }
  return false;
}

// "Damage Free Screen", "damage-free": la negación va después de la palabra.
const NEGATION_AFTER_RE = /^[\s-]*free\b/i;

// Dónde termina una oración. Incluye los separadores de lista que usan los
// refurbishers ("⋅", "|", "•"), que en la práctica funcionan como puntos.
const SENTENCE_BOUNDARY_RE = /[.!?\n⋅|•]/;

function sentenceAround(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && !SENTENCE_BOUNDARY_RE.test(text[from - 1])) from--;
  let to = end;
  while (to < text.length && !SENTENCE_BOUNDARY_RE.test(text[to])) to++;
  return text.slice(from, to);
}

/**
 * true si `pattern` aparece al menos una vez hablando del equipo: sin negar
 * ("no damage", "damage free") y fuera de una oración que matchee
 * `ignoreContext` (típicamente la política de envíos y devoluciones).
 */
export function mentionsOutsideContext(
  text: string,
  pattern: RegExp,
  options: { ignoreNegated: boolean; ignoreContext?: RegExp },
): boolean {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (
      options.ignoreNegated &&
      (NEGATION_BEFORE_RE.test(text.slice(0, start)) || NEGATION_AFTER_RE.test(text.slice(end)))
    ) {
      continue;
    }
    if (options.ignoreContext?.test(sentenceAround(text, start, end))) continue;
    return true;
  }
  return false;
}

/**
 * Piezas sueltas: que una de estas no funcione ("One USB C Port not working",
 * "Trackpad not working") es un defecto menor que resta puntos, no una laptop
 * para repuestos. La batería no está: sin batería no se revende.
 */
const COMPONENT_WORDS =
  "ports?|usb(?:[\\s-]?[ac])?|webcam|camera|cam|speakers?|audio|sound|mic(?:rophone)?|bluetooth|wi-?fi|wireless|" +
  "fingerprint|reader|touch\\s*screen|touchscreen|touch|trackpad|touchpad|mouse|clicks?|keys?|keyboard|backlight|" +
  "stylus|pen|buttons?|jack|hdmi|ethernet|lan|sd|card|fan|led|lights?|sensor|nfc|sim|lte|wwan|display\\s*port|" +
  "screws?|covers?|feet|foot|rubber|latch";

/**
 * Laptop entera para repuestos o que no funciona. Cada alternativa tiene su
 * cuidado, medido contra 1.089 descartes que caían solo por la descripción:
 *  - "not working" no cuenta si lo que no funciona es un componente que se
 *    nombra justo antes (ver COMPONENT_WORDS).
 *  - "no power" no cuenta si sigue "adapter/cord/charger": "No power adapter
 *    included" era la mitad de esos descartes (402), y es solo que viene sin
 *    cargador.
 */
const UNIT_FAILURE_RE = new RegExp(
  "\\bfor\\s*parts\\b|\\bparts\\s*only\\b|\\bparts\\s*(?:\\/|or|&)?\\s*repair\\b" +
    // Entre el componente y "not working" puede haber un número con punto
    // ("1x USB 2.0 (NOT WORKING)"): el punto solo corta si no sigue un dígito.
    `|(?<!\\b(?:${COMPONENT_WORDS})\\b(?:[^.!?\\n|•]|\\.(?=\\d)){0,40})\\bnot\\s*working\\b` +
    "|\\bno\\s*power\\b(?!\\s*(?:(?:adapter|cord|supply|supplies|cable|charger|brick|pack|plug)s?\\b|ac\\b|included|issues?|problems?))" +
    "|\\b(?:does\\s*not|doesn'?t|won'?t|will\\s*not|cannot|can'?t)\\s*(?:power|turn|boot)\\s*(?:on|up)\\b" +
    "|\\bno\\s*enciende\\b|\\bno\\s*prende\\b",
  "i",
);

/**
 * Oraciones que hablan de la política de la tienda, no del equipo: "If the
 * item is not working as described, contact us", "except items listed as
 * AS-IS or for Parts/Repair", "May not include Focus Materials that are not
 * working or not tested". Eran casi todas las demás falsas alarmas.
 */
const POLICY_CONTEXT_RE =
  /return|refund|warrant|guarant|polic|listed\s+as|label|exclud|exception|unless|\bif\b|\bmay\b|\bshould\b|buyer|grade[sd]?\b|definition|not\s+tested|untested|focus\s+materials|\bwe\s+(?:will|do|are|can)|contact|as\s+described|\bitems\b|conditions\b|condition\s+notes|refurbished|open\s*box|units\b/i;

// Las plantillas rompen las oraciones con signos sueltos ("unless the item is
// listed ?AS-IS? or ?For Parts/Not Working?"), así que además de la oración se
// mira lo que viene justo antes de la frase.
const POLICY_LOOKBACK_CHARS = 120;

/**
 * Primera mención de `pattern` que habla del equipo, con su contexto, o null.
 * No cuenta si viene negada ("no cracks", "damage free"), ni si la oración o
 * lo que viene justo antes matchea `ignoreContext` (política, leyendas).
 * Devuelve el texto (y no solo true) para poder mostrar qué dijo el vendedor.
 */
function findOutsideContext(
  text: string,
  pattern: RegExp,
  ignoreContext: RegExp,
  options: { lookback: boolean } = { lookback: true },
): string | null {
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (NEGATION_BEFORE_RE.test(text.slice(0, start)) || NEGATION_AFTER_RE.test(text.slice(end))) continue;
    if (ignoreContext.test(sentenceAround(text, start, end))) continue;
    if (options.lookback && ignoreContext.test(text.slice(Math.max(0, start - POLICY_LOOKBACK_CHARS), start))) continue;
    return text.slice(Math.max(0, start - 50), end + 40).replace(/\s+/g, " ").trim();
  }
  return null;
}

/** La frase que dice que la laptop entera es para repuestos o no funciona, o null. */
export function findUnitFailure(text: string): string | null {
  return findOutsideContext(text, UNIT_FAILURE_RE, POLICY_CONTEXT_RE);
}

/**
 * Sin RAM: "NO RAM", "without memory", "RAM not included". No cuenta "no RAM
 * issues" ni la política ("may not include RAM").
 */
const MISSING_RAM_RE =
  /\b(?:no|without|missing|sin)\s*(?:ram|memory|memoria)\b(?!\s*(?:issues?|problems?|errors?|upgrades?))|\b(?:ram|memory)\s*(?:is\s*)?(?:not\s*included|missing|removed)\b/i;

export function declaresMissingRam(text: string): boolean {
  return mentionsOutsideContext(text, MISSING_RAM_RE, { ignoreNegated: false, ignoreContext: POLICY_CONTEXT_RE });
}

// Leyendas genéricas de condición ("Grade C: may have small cracks", "expect
// cosmetic flaws like scratches, dents, cracks"): no hablan de esta laptop.
const GRADE_LEGEND_RE =
  /grade|\bmay\b|\bcould\b|\bmight\b|possible|definition|cosmetic\s+condition|condition\s+(?:guide|scale)|expect|not\s+limited|such\s+as|\blike\b/i;
const NOT_ABOUT_THIS_UNIT_RE = new RegExp(`${POLICY_CONTEXT_RE.source}|${GRADE_LEGEND_RE.source}`, "i");

/**
 * Lo que no se revende: pantalla rajada o rota, y la bisagra rajada o rota.
 * Esto descarta. El resto de las grietas (bezel, carcasa, cerca del trackpad)
 * no: se marcan para revisar las fotos (ver findCosmeticNote).
 */
// Entre "screen" y "cracked" no puede haber otra pieza: "Screen Bezel
// Cracked" es el marco, no la pantalla.
const NOT_OTHER_PART = "(?:(?!bezel|frame|cover|case|housing|lid|palm|bottom|corner|hinge)[^.!?\\n|•])";
const SEVERE_CRACK_RE = new RegExp(
  `\\b(?:screen|lcd|display|panel|glass|digitizer)\\b${NOT_OTHER_PART}{0,25}?\\b(?:cracked|cracks?|shattered|broken)\\b` +
    `|\\b(?:cracked|cracks?|shattered|broken)\\b${NOT_OTHER_PART}{0,25}?\\b(?:screen|lcd|display|panel|glass|digitizer)\\b` +
    "|\\bhinges?\\b(?:[^.!?\\n|•]){0,20}?\\b(?:cracked|cracks?|broken)\\b|\\b(?:cracked|broken)\\s+hinges?\\b",
  "i",
);

// Para lo grave se pide más para ignorarlo: solo la política de la tienda y
// los condicionales ("may have", "could"), y mirando nada más la oración.
// "Grade C: Cracked Screen – the screen on the device will be cracked" es esa
// laptop, aunque diga "Grade".
const SEVERE_IGNORE_RE =
  // "like" cubre las enumeraciones negadas: "does not have any major defects
  // like lines in the LCD".
  /return|refund|warrant|guarant|polic|\bif\b|\bmay\b|\bmight\b|\bcould\b|possible|\bunless\b|exclud|expect|not\s+limited|such\s+as|\blike\b/i;

/** La frase que dice que la pantalla o la bisagra está rajada o rota, o null. */
export function findSevereCrack(text: string): string | null {
  return findOutsideContext(text, SEVERE_CRACK_RE, SEVERE_IGNORE_RE, { lookback: false });
}

export function declaresSevereCrack(text: string): boolean {
  return findSevereCrack(text) !== null;
}

/**
 * Pantalla mala o teclado incompleto dicho en la descripción. En el título ya
 * lo cubren screen_defect y keyboard_defect, pero el vendedor lo escribe casi
 * siempre abajo: "Laptop has bad screen" (salió como alerta de 82 puntos),
 * "The LCD and screen are in poor condition with dents, scratches, missing
 * keys" (86 puntos). Los píxeles muertos no están: aparecen en casi todas las
 * leyendas de grado ("may have dead pixels", "up to 2 dead pixel").
 */
const SCREEN_OR_KEYBOARD_DEFECT_RE = new RegExp(
  "\\b(?:bad|poor|faulty|defective|damaged|dead|dim|blurry)\\s+(?:lcd\\s+|led\\s+)?(?:screen|lcd|display|panel)\\b" +
    "|\\b(?:screen|lcd|display|panel)s?\\s+(?:is\\s+|are\\s+|has\\s+|have\\s+)?(?:bad|faulty|defective|dead|not\\s+working|flicker\\w*|blank|black|dim)\\b" +
    "|\\b(?:screen|lcd|display|panel)s?\\b[^.!?\\n|•]{0,30}?\\b(?:is|are)\\s+in\\s+(?:poor|bad|rough)\\s+(?:condition|shape)" +
    "|\\blines?\\s+(?:on|across|in|through)\\s+(?:the\\s+)?(?:screen|lcd|display)\\b|\\b(?:vertical|horizontal)\\s+lines?\\b" +
    "|\\bmissing\\s+(?:keys?|keycaps?)\\b|\\bkeys?\\s+(?:are\\s+|is\\s+)?missing\\b",
  "i",
);

/** La frase que dice que la pantalla está mala o que faltan teclas, o null. */
export function findScreenOrKeyboardDefect(text: string): string | null {
  return findOutsideContext(text, SCREEN_OR_KEYBOARD_DEFECT_RE, SEVERE_IGNORE_RE, { lookback: false });
}

// Detalles que se aceptan si son chicos, pero hay que verlos en las fotos.
// En la descripción solo grietas y "broken": "minor scratches and dents" está
// en casi todas las usadas y marcaría todo. En el título, además, golpes y
// daño estético declarado (el vendedor lo destaca, así que vale mirarlo).
const COSMETIC_DESCRIPTION_RE = /\b(?:cracked|cracks?|broken)\b/i;
const COSMETIC_TITLE_RE = /\b(?:cracked|cracks?|dented|dents?|cosmetic\s*(?:issues?|damage|defects?|flaws?))\b/i;

/**
 * Lo que dijo el vendedor sobre una grieta, golpe o daño estético, para
 * revisar las fotos antes de comprar, o null. No descarta: marca.
 */
export function findCosmeticNote(title: string, description: string): string | null {
  return (
    findOutsideContext(title, COSMETIC_TITLE_RE, NOT_ABOUT_THIS_UNIT_RE) ??
    findOutsideContext(description, COSMETIC_DESCRIPTION_RE, NOT_ABOUT_THIS_UNIT_RE)
  );
}

/** true si la descripción dice que la laptop entera es para repuestos o no funciona. */
export function declaresUnitFailure(text: string): boolean {
  return findUnitFailure(text) !== null;
}

const MIN_DESCRIPTION_LENGTH = 20;

/** true si el vendedor puso una descripción con contenido real (no vacía/boilerplate corta). */
export function hasMeaningfulDescription(descriptionText: string): boolean {
  return descriptionText.trim().length >= MIN_DESCRIPTION_LENGTH;
}

// Cubre las formas reales en que los vendedores anuncian que no lleva disco:
// "NO HD", "no hdd", "sin disco", "without ssd", "missing hard drive", etc.
// Ojo: "no hd" no matchea dentro de "no hdmi" por el \b final, y "no dvd drive"
// tampoco (exige que la palabra venga pegada al "no").
const MISSING_STORAGE_PHRASE_RE =
  /\b(?:no|without|missing|sin)\s*(?:hard\s*(?:drive|disk)|hdd|hd|ssd|nvme|m\.?2|storage|drive|disco(?:\s*duro)?|almacenamiento)\b/i;

export function mentionsNoStorage(text: string): boolean {
  return MISSING_STORAGE_PHRASE_RE.test(text);
}

/**
 * Huella para detectar republicaciones del mismo equipo: hay vendedores que
 * suben la misma laptop 10 veces cambiando solo un carácter del título
 * ("... NO HD", "... NO HD *", "... NO HD ~") para ocupar más lugar en la
 * búsqueda. Normalizar a solo letras y números las colapsa a una sola.
 */
export function listingFingerprint(title: string, price: number | null): string {
  const normalized = title
    .toLowerCase()
    // 13.3in / 13.3 inch / 13.3" son la misma medida escrita distinto, y es la
    // variación más común entre republicaciones del mismo equipo.
    .replace(/(\d)\s*(?:inches|inch|in)\b/g, "$1")
    .replace(/[^a-z0-9]/g, "");
  return `${normalized}|${Math.round(price ?? 0)}`;
}

const RAM_EXPLICIT_RE = /(\d{1,3})\s?gb\s*(?:ram|ddr\d?|memory|memoria)|(?:ram|memory|memoria)\s*[:\-]?\s*(\d{1,3})\s?gb/i;
// Sin la palabra "RAM": muchos títulos ponen "16GB 512GB SSD" o "16GB/256GB".
// Se distingue por tamaño, que en laptops no se solapa: la RAM llega hasta 64GB
// y el almacenamiento arranca en 128GB.
const RAM_BARE_RE = /\b(4|6|8|12|16|20|24|32|36|40|48|64)\s?gb\b/i;

/** Devuelve los GB de RAM mencionados, o 0 si no se detecta. */
export function extractRamGb(text: string): number {
  const explicit = text.match(RAM_EXPLICIT_RE);
  if (explicit) {
    const gb = Number(explicit[1] ?? explicit[2]);
    if (!Number.isNaN(gb)) return gb;
  }

  const bare = text.match(RAM_BARE_RE);
  if (bare) {
    const gb = Number(bare[1]);
    if (!Number.isNaN(gb)) return gb;
  }

  return 0;
}

const STORAGE_TB_RE = /\b(\d)\s?tb\b/i;
const STORAGE_GB_RE = /(\d{3,4})\s?gb\s*(ssd|hdd|nvme|storage)?/i;
// Sin "GB": "256SSD", "512 NVMe". Solo capacidades reales de disco, para no
// confundir un número de modelo con almacenamiento.
const STORAGE_BARE_RE = /\b(120|128|240|250|256|480|500|512|960|1000|2000)\s?(?:ssd|nvme|m\.?2)\b/i;

/** Devuelve los GB de almacenamiento mencionados (1TB -> 1000), o 0 si no se detecta. */
export function extractStorageGb(text: string): number {
  const tbMatch = text.match(STORAGE_TB_RE);
  if (tbMatch) return Number(tbMatch[1]) * 1000;
  const gbMatch = text.match(STORAGE_GB_RE) ?? text.match(STORAGE_BARE_RE);
  const gb = gbMatch ? Number(gbMatch[1]) : 0;
  return Number.isNaN(gb) ? 0 : gb;
}

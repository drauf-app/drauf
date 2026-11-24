/**
 * Minimal HTML entity decoding for text lifted out of pages: some sites
 * (Cookidoo among them) leave entities like &frac12; inside their JSON-LD
 * strings. Decodes numeric references and the named entities seen in recipe
 * text; unknown names stay untouched, and decoding runs exactly once, so
 * double-encoded text (&amp;frac12;) correctly yields the literal entity.
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  ccedil: 'ç',
  deg: '°',
  ndash: '\u2013',
  mdash: '\u2014',
};

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

const SCRIPT_PATTERN =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectCandidates(value: unknown, into: JsonObject[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectCandidates(item, into);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  into.push(value);
  if (value['@graph'] !== undefined) {
    collectCandidates(value['@graph'], into);
  }
}

/** Finds the first JSON-LD object of the given @type in an HTML document. */
export function findJsonLd(html: string, type: string): JsonObject | undefined {
  for (const match of html.matchAll(SCRIPT_PATTERN)) {
    const raw = match[1];
    if (raw === undefined) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // One broken block must not abort the whole import.
    }
    const candidates: JsonObject[] = [];
    collectCandidates(parsed, candidates);
    for (const candidate of candidates) {
      const candidateType = candidate['@type'];
      if (
        candidateType === type ||
        (Array.isArray(candidateType) && candidateType.includes(type))
      ) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** Reads a string property that may be a string, array of strings, or {url}. */
export function readStringish(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') {
    return decodeHtmlEntities(value.trim());
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = readStringish(item);
      if (found !== null) {
        return found;
      }
    }
    return null;
  }
  if (isObject(value)) {
    return readStringish(value.url);
  }
  return null;
}

export function readMetaContent(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)\\s*=\\s*["']${property}["'][^>]*content\\s*=\\s*["']([^"']+)["']`,
    'i',
  );
  const match = pattern.exec(html);
  const content = match?.[1]?.trim();
  return content ? decodeHtmlEntities(content) : null;
}

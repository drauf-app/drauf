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
    return value.trim();
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
  return match?.[1]?.trim() || null;
}

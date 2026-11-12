import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeItemName } from '@drauf/shared';

/** One catalogue item as stored in the data files. */
export interface CatalogItem {
  name: string;
  /** Key of the base category the item belongs to (from the file name). */
  categoryKey: string;
  synonyms: string[];
  icon: string;
  /** Typical package sizes, each parseable as "<number> <unit>". */
  sizes: string[];
  /** Variety chips (e.g. pasta shapes). */
  varieties: string[];
}

interface RawCatalogItem {
  name?: unknown;
  synonyms?: unknown;
  icon?: unknown;
  sizes?: unknown;
  varieties?: unknown;
}

// Resolves to <package root>/data from both src/ (dev) and dist/ (build).
function dataDir(): string {
  return fileURLToPath(new URL('../data', import.meta.url));
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** Loads the whole catalogue from the data files. Throws on malformed JSON. */
export function loadCatalog(): CatalogItem[] {
  const dir = dataDir();
  const items: CatalogItem[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json')) {
      continue;
    }
    const categoryKey = file.slice(0, -'.json'.length);
    const raw = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RawCatalogItem[];
    for (const entry of raw) {
      if (typeof entry.name !== 'string' || entry.name.trim() === '') {
        throw new Error(`catalog item without name in ${file}`);
      }
      items.push({
        name: entry.name,
        categoryKey,
        synonyms: readStrings(entry.synonyms),
        icon: typeof entry.icon === 'string' ? entry.icon : '',
        sizes: readStrings(entry.sizes),
        varieties: readStrings(entry.varieties),
      });
    }
  }
  return items;
}

export interface CatalogIndex {
  /** Exact normalized name or synonym → item. */
  byName: Map<string, CatalogItem>;
  /** Prefix search over names and synonyms; results are unique items. */
  search(query: string, limit: number): CatalogItem[];
  /**
   * Exact or compound match for category guessing: German compounds put the
   * head noun last ("Zwiebelsuppe" is a Suppe), so the longest catalogue name
   * that the input's last word ends with decides.
   */
  match(name: string): CatalogItem | undefined;
}

/** Shortest alias that may match as a proper compound suffix ("öl" is too risky). */
const MIN_SUFFIX_LENGTH = 4;

/** Plural-tolerant key variants: "zwiebeln" also matches the singular word. */
function keyVariants(key: string): string[] {
  return key.endsWith('n') && key.length > MIN_SUFFIX_LENGTH ? [key, key.slice(0, -1)] : [key];
}

/** Builds the in-memory search index the server keeps for its lifetime. */
export function buildCatalogIndex(items: CatalogItem[]): CatalogIndex {
  const byName = new Map<string, CatalogItem>();
  // Sorted keys make prefix scans deterministic (and alphabetical per query).
  const keys: string[] = [];
  for (const item of items) {
    for (const alias of [item.name, ...item.synonyms]) {
      const key = normalizeItemName(alias);
      if (!byName.has(key)) {
        byName.set(key, item);
        keys.push(key);
      }
    }
  }
  keys.sort();
  // Longest candidates first, so "olivenöl" wins over "öl" for compounds.
  const suffixCandidates: Array<[string, CatalogItem]> = [];
  for (const [key, item] of byName) {
    for (const variant of keyVariants(key)) {
      suffixCandidates.push([variant, item]);
    }
  }
  suffixCandidates.sort((a, b) => b[0].length - a[0].length);
  return {
    byName,
    match(name) {
      const normalized = normalizeItemName(name);
      if (normalized === '') {
        return undefined;
      }
      const exact = byName.get(normalized);
      if (exact !== undefined) {
        return exact;
      }
      const lastWord = normalized.split(' ').at(-1) ?? '';
      for (const [key, item] of suffixCandidates) {
        if (key === lastWord) {
          return item; // "TK Spinat", or a singular of a plural catalogue name
        }
        if (
          key.length >= MIN_SUFFIX_LENGTH &&
          lastWord.length > key.length &&
          lastWord.endsWith(key)
        ) {
          return item; // compound head: "Würzspinat" → Spinat
        }
      }
      return undefined;
    },
    search(query, limit) {
      const prefix = normalizeItemName(query);
      if (prefix === '') {
        return [];
      }
      const results: CatalogItem[] = [];
      const seen = new Set<CatalogItem>();
      for (const key of keys) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        const item = byName.get(key) as CatalogItem;
        if (!seen.has(item)) {
          seen.add(item);
          results.push(item);
          if (results.length >= limit) {
            break;
          }
        }
      }
      return results;
    },
  };
}

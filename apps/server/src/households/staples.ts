import type { Household } from '../db/schema/types.js';

/**
 * Staple ingredients deselected by default in the recipe import preview.
 * Used while a household has not saved its own list (households.staples is
 * null); matching is on the parsed, lowercased ingredient name.
 */
export const DEFAULT_STAPLES: readonly string[] = [
  'Wasser',
  'Salz',
  'Pfeffer',
  'Salz & Pfeffer',
  'Öl',
  'Olivenöl',
  'Zucker',
];

/** The household's staples list: its own when saved, the defaults otherwise. */
export function effectiveStaples(household: Household): string[] {
  if (household.staples === null) {
    return [...DEFAULT_STAPLES];
  }
  try {
    const parsed: unknown = JSON.parse(household.staples);
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) {
      return parsed;
    }
  } catch {
    // Unreadable column content falls back to the defaults below.
  }
  return [...DEFAULT_STAPLES];
}

/** Lowercased set for marking parsed ingredient names as staples. */
export function stapleSet(household: Household): Set<string> {
  return new Set(effectiveStaples(household).map((name) => name.toLowerCase()));
}

/** Trims, collapses whitespace and dedupes case-insensitively (first casing wins). */
export function normalizeStaples(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name === '' || seen.has(name.toLowerCase())) {
      continue;
    }
    seen.add(name.toLowerCase());
    result.push(name);
  }
  return result;
}

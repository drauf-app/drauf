/**
 * Cooked-recipes memory (#88): derived entirely from past plan entries, no
 * extra table. Entries group by their normalized title; each suggestion
 * carries when it was last cooked and how often.
 */

export interface CookedEntryRow {
  text: string | null;
  link: string | null;
  imageUrl: string | null;
  date: string;
}

export interface RecipeSuggestion {
  text: string;
  link: string | null;
  imageUrl: string | null;
  /** ISO calendar date of the most recent time this was on the plan. */
  lastCookedAt: string;
  timesCooked: number;
}

/** Title matching: trimmed, whitespace-collapsed, case-insensitive. */
function normalizeTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Groups rows (expected newest first) into suggestions, optionally filtered
 * by a query. The newest row names the recipe and dates it; link and image
 * come from the newest row that has them.
 */
export function recipeSuggestions(
  rows: CookedEntryRow[],
  query: string,
  limit: number,
): RecipeSuggestion[] {
  const q = normalizeTitle(query);
  const byTitle = new Map<string, RecipeSuggestion>();
  for (const row of rows) {
    if (row.text === null) {
      continue;
    }
    const key = normalizeTitle(row.text);
    if (key === '' || (q !== '' && !key.includes(q))) {
      continue;
    }
    const existing = byTitle.get(key);
    if (existing === undefined) {
      byTitle.set(key, {
        text: row.text.trim().replace(/\s+/g, ' '),
        link: row.link,
        imageUrl: row.imageUrl,
        lastCookedAt: row.date,
        timesCooked: 1,
      });
    } else {
      existing.timesCooked += 1;
      existing.link ??= row.link;
      existing.imageUrl ??= row.imageUrl;
    }
  }
  // Rows arrive newest first, so insertion order already is recency order.
  return [...byTitle.values()].slice(0, limit);
}

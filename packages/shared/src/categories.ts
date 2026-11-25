/**
 * Seeded base categories (spec L5). Keys are stable identifiers referenced by
 * the item catalogue and the database seed; names are user-facing data,
 * German first. Icons are defaults, overridable per household (#71) — keep
 * the emoji list in sync with UI_ICONS in apps/web/scripts/fetch-openmoji.mjs
 * so every default has a bundled asset.
 */
export const BASE_CATEGORIES: ReadonlyArray<{ key: string; name: string; icon: string }> = [
  { key: 'fruit-vegetables', name: 'Obst & Gemüse', icon: '🥕' },
  { key: 'bread-bakery', name: 'Brot & Backwaren', icon: '🥖' },
  { key: 'fresh-counter', name: 'Frischetheke', icon: '🥩' },
  { key: 'dairy-chilled', name: 'Kühlregal & Molkerei', icon: '🥛' },
  { key: 'frozen', name: 'Tiefkühl', icon: '🧊' },
  { key: 'pasta-rice-canned', name: 'Nudeln, Reis & Konserven', icon: '🍝' },
  { key: 'baking-spices', name: 'Backen & Gewürze', icon: '🧂' },
  { key: 'breakfast-sweets', name: 'Frühstück & Süßes', icon: '🥐' },
  { key: 'snacks', name: 'Snacks', icon: '🥨' },
  { key: 'drinks', name: 'Getränke', icon: '🥤' },
  { key: 'drugstore-hygiene', name: 'Drogerie & Hygiene', icon: '🧼' },
  { key: 'household', name: 'Haushalt', icon: '🧹' },
  { key: 'other', name: 'Sonstiges', icon: '📦' },
];

export const BASE_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  BASE_CATEGORIES.map((category) => category.key),
);

const BASE_CATEGORY_ICONS: ReadonlyMap<string, string> = new Map(
  BASE_CATEGORIES.map((category) => [category.key, category.icon]),
);

/** The default icon of a seeded base category; undefined for household-created ones. */
export function baseCategoryIcon(key: string | null): string | undefined {
  return key === null ? undefined : BASE_CATEGORY_ICONS.get(key);
}

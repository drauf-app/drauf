/**
 * Seeded base categories (spec L5). Keys are stable identifiers referenced by
 * the item catalogue and the database seed; names are user-facing data,
 * German first.
 */
export const BASE_CATEGORIES: ReadonlyArray<{ key: string; name: string }> = [
  { key: 'fruit-vegetables', name: 'Obst & Gemüse' },
  { key: 'bread-bakery', name: 'Brot & Backwaren' },
  { key: 'fresh-counter', name: 'Frischetheke' },
  { key: 'dairy-chilled', name: 'Kühlregal & Molkerei' },
  { key: 'frozen', name: 'Tiefkühl' },
  { key: 'pasta-rice-canned', name: 'Nudeln, Reis & Konserven' },
  { key: 'baking-spices', name: 'Backen & Gewürze' },
  { key: 'breakfast-sweets', name: 'Frühstück & Süßes' },
  { key: 'snacks', name: 'Snacks' },
  { key: 'drinks', name: 'Getränke' },
  { key: 'drugstore-hygiene', name: 'Drogerie & Hygiene' },
  { key: 'household', name: 'Haushalt' },
  { key: 'other', name: 'Sonstiges' },
];

export const BASE_CATEGORY_KEYS: ReadonlySet<string> = new Set(
  BASE_CATEGORIES.map((category) => category.key),
);

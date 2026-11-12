import type { Category, EntryView, QuantityGroup } from '../api/types';

export interface CategoryGroup {
  /** undefined = entries without a category; rendered last. */
  category: Category | undefined;
  entries: EntryView[];
}

/**
 * Groups unchecked entries by category in the household's category order;
 * entries without a category come last. Within a group insertion order
 * (createdAt) is kept.
 */
export function groupEntries(entries: EntryView[], categories: Category[]): CategoryGroup[] {
  const open = entries.filter((entry) => entry.checkedAt === null);
  const byCategory = new Map<string | null, EntryView[]>();
  for (const entry of open) {
    const group = byCategory.get(entry.categoryId);
    if (group === undefined) {
      byCategory.set(entry.categoryId, [entry]);
    } else {
      group.push(entry);
    }
  }
  const groups: CategoryGroup[] = [];
  for (const category of [...categories].sort((a, b) => a.sortOrder - b.sortOrder)) {
    const grouped = byCategory.get(category.id);
    if (grouped !== undefined) {
      groups.push({ category, entries: grouped });
    }
  }
  const uncategorized = byCategory.get(null);
  if (uncategorized !== undefined) {
    groups.push({ category: undefined, entries: uncategorized });
  }
  return groups;
}

/** Checked entries, most recently checked first ("Zuletzt gekauft"). */
export function recentEntries(entries: EntryView[]): EntryView[] {
  return entries
    .filter((entry) => entry.checkedAt !== null)
    .sort((a, b) => (b.checkedAt ?? '').localeCompare(a.checkedAt ?? ''));
}

const QUANTITY_FORMAT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

/** "1 Stück + 50 g": summed per unit, different units side by side. */
export function formatQuantities(quantities: QuantityGroup[]): string {
  return quantities
    .map((group) => {
      const amount = QUANTITY_FORMAT.format(group.quantity);
      return group.unit === null ? amount : `${amount} ${group.unit}`;
    })
    .join(' + ');
}

/** Replaces an entry in place (matched by id) or appends it. */
export function upsertEntry(entries: EntryView[], view: EntryView): EntryView[] {
  const index = entries.findIndex((entry) => entry.id === view.id);
  if (index === -1) {
    return [...entries, view];
  }
  const next = [...entries];
  next[index] = view;
  return next;
}

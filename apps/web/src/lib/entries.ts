import type { Category, EntryView, QuantityGroup } from '../api/types';

export interface CategoryGroup {
  /** undefined = entries without a category; rendered last. */
  category: Category | undefined;
  entries: EntryView[];
}

/** Household order, or the selected store's aisle order with the rest after. */
function orderedCategories(categories: Category[], storeOrder: string[] | undefined): Category[] {
  const byHousehold = [...categories].sort((a, b) => a.sortOrder - b.sortOrder);
  if (storeOrder === undefined || storeOrder.length === 0) {
    return byHousehold;
  }
  const position = new Map(storeOrder.map((id, index) => [id, index]));
  const inStore = byHousehold.filter((category) => position.has(category.id));
  inStore.sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  return [...inStore, ...byHousehold.filter((category) => !position.has(category.id))];
}

/**
 * Groups unchecked entries by category — in the household's category order,
 * or re-sorted for the selected store (L7); entries without a category come
 * last. Within a group insertion order (createdAt) is kept.
 */
export function groupEntries(
  entries: EntryView[],
  categories: Category[],
  storeOrder?: string[],
): CategoryGroup[] {
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
  for (const category of orderedCategories(categories, storeOrder)) {
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

/** Applies one live sync event from the list topic to local entry state. */
export function applyListEvent(
  entries: EntryView[],
  event: { type: string; data: unknown },
): EntryView[] {
  switch (event.type) {
    case 'entry.created':
    case 'entry.updated':
    case 'entry.checked':
    case 'entry.unchecked':
      return upsertEntry(entries, event.data as EntryView);
    case 'entry.deleted': {
      const { id } = event.data as { id: string };
      return entries.filter((entry) => entry.id !== id);
    }
    default:
      return entries;
  }
}

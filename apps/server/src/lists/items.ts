import type { CatalogIndex } from '@drauf/catalog';
import { normalizeItemName } from '@drauf/shared';
import type { Database } from '../db/index.js';
import {
  createEntryPortion,
  createListEntry,
  deletePortionsForEntry,
  findMergeableEntry,
  getCatalogUsage,
  getListHouseholdId,
  listCategories,
  listEntriesForList,
  listPortionsForEntries,
  recordCatalogUsage,
  updateListEntry,
} from '../db/repositories.js';
import type { EntryPortion, ListEntry, PortionOrigin } from '../db/schema/types.js';

export { normalizeItemName } from '@drauf/shared';

function normalizeOptional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

export interface QuantityGroup {
  unit: string | null;
  quantity: number;
  /** Pack count, only when one counted portion makes up the group (2 × 500 g). */
  count?: number;
}

export interface EntryView extends ListEntry {
  /** Summed per unit (200 g + 300 g = 500 g); different units stay side by side. */
  quantities: QuantityGroup[];
  /** Every partial quantity with its origin, so merges stay traceable. */
  portions: EntryPortion[];
  /** Catalogue icon for tile views; resolved by name, null when unknown. */
  icon: string | null;
}

export function buildEntryView(
  entry: ListEntry,
  portions: EntryPortion[],
  catalog?: CatalogIndex,
): EntryView {
  const groups = new Map<string | null, { sum: number; portions: EntryPortion[] }>();
  for (const portion of portions) {
    // A bare pack count ("3") contributes like an unitless quantity of 3.
    const effective =
      portion.quantity === null ? portion.count : (portion.count ?? 1) * portion.quantity;
    if (effective === null) {
      continue;
    }
    const key = portion.quantity === null ? null : portion.unit;
    const group = groups.get(key) ?? { sum: 0, portions: [] };
    group.sum += effective;
    group.portions.push(portion);
    groups.set(key, group);
  }
  // No unit conversion in v1: each distinct unit is its own group. A group
  // made of one counted portion keeps both numbers visible (2 × 500 g);
  // merged groups sum count × quantity as before.
  const quantities: QuantityGroup[] = [...groups.entries()].map(([unit, group]) => {
    const only = group.portions.length === 1 ? group.portions[0] : undefined;
    if (only !== undefined && only.quantity !== null && only.count !== null && only.count > 1) {
      return { unit, quantity: only.quantity, count: only.count };
    }
    return { unit, quantity: group.sum };
  });
  return { ...entry, quantities, portions, icon: catalog?.match(entry.name)?.icon ?? null };
}

export interface AddItemInput {
  name: string;
  quantity?: number;
  unit?: string;
  count?: number;
  variant?: string;
  note?: string;
  /** Validated against the list's households by the caller. */
  categoryId?: string | null;
}

export interface AddItemResult {
  entry: ListEntry;
  merged: boolean;
}

/**
 * Guesses the category for an uncategorized item (K3): the household's own
 * learned choice wins, then a catalogue match (exact name/synonym or German
 * compound head, e.g. "Zwiebelsuppe" → Suppe) resolved to the household's
 * category.
 */
async function guessCategoryId(
  database: Database,
  householdId: string,
  name: string,
  nameNormalized: string,
  catalog: CatalogIndex | undefined,
): Promise<string | null> {
  const usage = await getCatalogUsage(database, householdId, nameNormalized);
  if (usage !== undefined && usage.categoryId !== null) {
    return usage.categoryId;
  }
  const item = catalog?.match(name);
  if (item === undefined) {
    return null;
  }
  const categories = await listCategories(database, householdId);
  return categories.find((category) => category.key === item.categoryKey)?.id ?? null;
}

/**
 * Adds an item to a list: merges into the unchecked entry with the same
 * normalized name and variant if one exists, otherwise creates a new entry.
 * The quantity is always recorded as a separate portion with its origin.
 * Items without a category get one guessed from history or the catalogue.
 */
export async function addItemToList(
  database: Database,
  listId: string,
  userId: string | null,
  input: AddItemInput,
  origin: PortionOrigin = 'manual',
  catalog?: CatalogIndex,
): Promise<AddItemResult> {
  const nameNormalized = normalizeItemName(input.name);
  const variant = normalizeOptional(input.variant);
  const note = normalizeOptional(input.note);

  const householdId = await getListHouseholdId(database, listId);
  let categoryId = input.categoryId ?? null;
  if (categoryId === null && householdId !== undefined) {
    categoryId = await guessCategoryId(database, householdId, input.name, nameNormalized, catalog);
  }
  const existing = await findMergeableEntry(database, listId, nameNormalized, variant);
  let entry: ListEntry;
  let merged: boolean;
  if (existing !== undefined) {
    merged = true;
    entry = existing;
    // Like the note, a category is adopted on merge only when none is set yet.
    const patch = {
      ...(note !== null && existing.note === null ? { note } : {}),
      ...(categoryId !== null && existing.categoryId === null ? { categoryId } : {}),
    };
    if (Object.keys(patch).length > 0) {
      await updateListEntry(database, existing.id, patch);
      entry = { ...existing, ...patch };
    }
  } else {
    merged = false;
    entry = await createListEntry(database, {
      listId,
      name: input.name.trim().replace(/\s+/g, ' '),
      nameNormalized,
      variant,
      note,
      categoryId,
    });
  }

  await createEntryPortion(database, {
    entryId: entry.id,
    quantity: input.quantity ?? null,
    unit: normalizeOptional(input.unit),
    count: input.count ?? null,
    origin,
    addedById: userId,
  });

  // Every add path (REST, sync replay, import) feeds the household's
  // shopping history, which powers quick-add suggestions (K4).
  if (householdId !== undefined) {
    await recordCatalogUsage(database, householdId, {
      name: entry.name,
      nameNormalized: entry.nameNormalized,
      quantity: input.quantity ?? null,
      unit: normalizeOptional(input.unit),
      count: input.count ?? null,
      variant,
      categoryId: entry.categoryId,
    });
  }
  return { entry, merged };
}

export async function getEntryViews(
  database: Database,
  listId: string,
  catalog?: CatalogIndex,
): Promise<EntryView[]> {
  const entries = await listEntriesForList(database, listId);
  const portions = await listPortionsForEntries(
    database,
    entries.map((entry) => entry.id),
  );
  const byEntry = new Map<string, EntryPortion[]>();
  for (const portion of portions) {
    const group = byEntry.get(portion.entryId);
    if (group === undefined) {
      byEntry.set(portion.entryId, [portion]);
    } else {
      group.push(portion);
    }
  }
  return entries.map((entry) => buildEntryView(entry, byEntry.get(entry.id) ?? [], catalog));
}

export async function getEntryView(
  database: Database,
  entry: ListEntry,
  catalog?: CatalogIndex,
): Promise<EntryView> {
  return buildEntryView(entry, await listPortionsForEntries(database, [entry.id]), catalog);
}

/** An explicit amount edit replaces all portions with one manual portion. */
export async function replaceEntryQuantity(
  database: Database,
  entry: ListEntry,
  userId: string | null,
  quantity: number | null,
  unit: string | undefined,
  count: number | null = null,
): Promise<void> {
  await deletePortionsForEntry(database, entry.id);
  await createEntryPortion(database, {
    entryId: entry.id,
    quantity,
    unit: normalizeOptional(unit),
    count,
    origin: 'manual',
    addedById: userId,
  });
}

import type { Database } from '../db/index.js';
import {
  getStoreCategoryOrder,
  listAllPlanEntries,
  listCatalogUsage,
  listCategories,
  listEntriesForList,
  listHouseholdLists,
  listHouseholdMemberUsers,
  listListMemberUsers,
  listMealSlots,
  listPortionsForEntries,
  listStores,
} from '../db/repositories.js';
import type { Household } from '../db/schema/types.js';
import { effectiveStaples } from './staples.js';

/**
 * Bumped only when the shape changes incompatibly, so a later import can
 * read old files.
 */
export const EXPORT_VERSION = 1;

/**
 * One self-contained JSON document with everything the household put into
 * Drauf: lists with entries and portions, categories, stores with their
 * aisle order, the meal plan, staples and the shopping history. Users
 * appear as id/username/displayName references only — no credentials, no
 * tokens (part of the backup story next to the DB dump).
 */
export async function buildHouseholdExport(database: Database, household: Household) {
  const [users, categories, stores, slots, plan, usage, lists] = await Promise.all([
    listHouseholdMemberUsers(database, household.id),
    listCategories(database, household.id),
    listStores(database, household.id),
    listMealSlots(database, household.id),
    listAllPlanEntries(database, household.id),
    listCatalogUsage(database, household.id),
    listHouseholdLists(database, household.id),
  ]);

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    household: {
      id: household.id,
      name: household.name,
      staples: effectiveStaples(household),
      staplesCustom: household.staples !== null,
    },
    users,
    categories,
    stores: await Promise.all(
      stores.map(async (store) => ({
        ...store,
        categoryOrder: await getStoreCategoryOrder(database, store.id),
      })),
    ),
    mealSlots: slots,
    planEntries: plan,
    catalogUsage: usage,
    lists: await Promise.all(
      lists.map(async (list) => {
        const entries = await listEntriesForList(database, list.id);
        const portions = await listPortionsForEntries(
          database,
          entries.map((entry) => entry.id),
        );
        return {
          ...list,
          members: (await listListMemberUsers(database, list.id)).map((member) => member.userId),
          entries: entries.map((entry) => ({
            ...entry,
            portions: portions.filter((portion) => portion.entryId === entry.id),
          })),
        };
      }),
    ),
  };
}

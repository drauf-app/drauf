import { BASE_CATEGORIES } from '@drauf/shared';
import type { Database } from './index.js';
import {
  createCategory,
  createHousehold,
  createMealSlot,
  getDefaultHousehold,
  listCategories,
} from './repositories.js';

/** Well-known id of the single fixed household every install starts with. */
export const DEFAULT_HOUSEHOLD_ID = '00000000-0000-7000-8000-000000000000';

/**
 * Creates the fixed default household and its base categories where missing.
 * Idempotent; base categories added in later releases appear on upgrade.
 */
export async function seedDefaultHousehold(database: Database): Promise<void> {
  let household = await getDefaultHousehold(database);
  if (household === undefined) {
    household = await createHousehold(database, {
      id: DEFAULT_HOUSEHOLD_ID,
      // The default name is user-facing data, not a UI string: German first.
      name: 'Zuhause',
      isDefault: true,
    });
    // Starter meal slots only at household creation: unlike base categories
    // they are fully editable and deletable, so the seed must not resurrect them.
    await createMealSlot(database, {
      householdId: household.id,
      name: 'Mittagessen',
      sortOrder: 10,
    });
    await createMealSlot(database, {
      householdId: household.id,
      name: 'Abendessen',
      sortOrder: 20,
    });
  }

  const existingKeys = new Set(
    (await listCategories(database, household.id)).map((category) => category.key),
  );
  for (const [index, base] of BASE_CATEGORIES.entries()) {
    if (!existingKeys.has(base.key)) {
      await createCategory(database, {
        householdId: household.id,
        key: base.key,
        name: base.name,
        sortOrder: (index + 1) * 10,
      });
    }
  }
}

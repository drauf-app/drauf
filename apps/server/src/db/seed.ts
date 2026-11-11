import type { Database } from './index.js';
import { createHousehold, getDefaultHousehold } from './repositories.js';

/** Well-known id of the single fixed household every install starts with. */
export const DEFAULT_HOUSEHOLD_ID = '00000000-0000-7000-8000-000000000000';

/** Creates the fixed default household if it does not exist yet. Idempotent. */
export async function seedDefaultHousehold(database: Database): Promise<void> {
  const existing = await getDefaultHousehold(database);
  if (existing !== undefined) {
    return;
  }
  // The default name is user-facing data, not a UI string: German first.
  await createHousehold(database, { id: DEFAULT_HOUSEHOLD_ID, name: 'Zuhause', isDefault: true });
}

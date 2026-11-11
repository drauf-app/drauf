import type { Database } from '../db/index.js';
import { getDefaultHousehold, isHouseholdMember } from '../db/repositories.js';
import type { Household } from '../db/schema/types.js';

/**
 * Resolves the household the user acts in — the fixed default household in
 * the MVP — and checks membership. The single read path for household access.
 */
export async function getHouseholdForMember(
  database: Database,
  userId: string,
): Promise<Household | undefined> {
  const household = await getDefaultHousehold(database);
  if (household === undefined) {
    return undefined;
  }
  return (await isHouseholdMember(database, household.id, userId)) ? household : undefined;
}

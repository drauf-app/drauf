import type { Database } from '../db/index.js';
import {
  addListHousehold,
  addListMember,
  createList,
  getDefaultHousehold,
  getListById,
  getListMember,
  listHouseholdMembers,
} from '../db/repositories.js';
import type { List } from '../db/schema/types.js';

/**
 * Creates a list in the default household. New lists start with all household
 * members as list members (spec L2); the owner can remove them per list.
 */
export async function createListForUser(
  database: Database,
  ownerId: string,
  input: { name: string; icon?: string; color?: string },
): Promise<List> {
  const list = await createList(database, {
    name: input.name,
    icon: input.icon ?? null,
    color: input.color ?? null,
    ownerId,
  });
  const household = await getDefaultHousehold(database);
  if (household !== undefined) {
    await addListHousehold(database, list.id, household.id);
    for (const member of await listHouseholdMembers(database, household.id)) {
      await addListMember(database, list.id, member.userId);
    }
  }
  // The owner is always a member, even if not part of the default household.
  await addListMember(database, list.id, ownerId);
  return list;
}

/** Returns the list only when the user is a member — the sole read path for list access. */
export async function getListForMember(
  database: Database,
  listId: string,
  userId: string,
): Promise<List | undefined> {
  const member = await getListMember(database, listId, userId);
  if (member === undefined) {
    return undefined;
  }
  return getListById(database, listId);
}

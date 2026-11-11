import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newId } from './ids.js';
import type { Database } from './index.js';
import type * as pgSchema from './schema/pg.js';
import type { Household, HouseholdMember, User } from './schema/types.js';

/**
 * Types queries against the Postgres schema while executing them on the
 * connection's actual dialect objects. This is safe because both schemas are
 * kept structurally identical (enforced at compile time in schema/types.ts)
 * and every repository function runs against both dialects in the tests.
 */
function unwrap(database: Database): { db: NodePgDatabase<typeof pgSchema>; t: typeof pgSchema } {
  return {
    db: database.db as NodePgDatabase<typeof pgSchema>,
    t: database.schema as typeof pgSchema,
  };
}

export async function createUser(
  database: Database,
  input: { username: string; displayName: string },
): Promise<User> {
  const { db, t } = unwrap(database);
  const user: User = { id: newId(), ...input, createdAt: new Date() };
  await db.insert(t.users).values(user);
  return user;
}

export async function getUserById(database: Database, id: string): Promise<User | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db.select().from(t.users).where(eq(t.users.id, id));
  return rows[0];
}

export async function createHousehold(
  database: Database,
  input: { id?: string; name: string; isDefault: boolean },
): Promise<Household> {
  const { db, t } = unwrap(database);
  const household: Household = {
    id: input.id ?? newId(),
    name: input.name,
    isDefault: input.isDefault,
    createdAt: new Date(),
  };
  await db.insert(t.households).values(household);
  return household;
}

export async function getDefaultHousehold(database: Database): Promise<Household | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db.select().from(t.households).where(eq(t.households.isDefault, true));
  return rows[0];
}

export async function addHouseholdMember(
  database: Database,
  householdId: string,
  userId: string,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.insert(t.householdMembers).values({ householdId, userId, createdAt: new Date() });
}

export async function listHouseholdMembers(
  database: Database,
  householdId: string,
): Promise<HouseholdMember[]> {
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.householdMembers)
    .where(eq(t.householdMembers.householdId, householdId))
    .orderBy(asc(t.householdMembers.createdAt));
}

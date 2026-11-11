import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase, type Database, runMigrations } from '../src/db/index.js';
import {
  addHouseholdMember,
  createHousehold,
  createUser,
  getDefaultHousehold,
  getUserById,
  listHouseholdMembers,
} from '../src/db/repositories.js';
import { DEFAULT_HOUSEHOLD_ID, seedDefaultHousehold } from '../src/db/seed.js';

function suite(getDb: () => Database) {
  it('seeds the default household idempotently', async () => {
    const database = getDb();
    await seedDefaultHousehold(database);

    const household = await getDefaultHousehold(database);
    expect(household).toMatchObject({ id: DEFAULT_HOUSEHOLD_ID, isDefault: true });
    expect(household?.createdAt).toBeInstanceOf(Date);
  });

  it('creates and reads back a user', async () => {
    const database = getDb();
    const created = await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });

    const found = await getUserById(database, created.id);
    expect(found).toEqual(created);
    expect(found?.createdAt).toBeInstanceOf(Date);
  });

  it('rejects duplicate usernames', async () => {
    const database = getDb();
    await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });

    await expect(
      createUser(database, { username: 'kathrin', displayName: 'Someone else' }),
    ).rejects.toThrow();
  });

  it('rejects a second default household', async () => {
    await expect(
      createHousehold(getDb(), { name: 'Second home', isDefault: true }),
    ).rejects.toThrow();
  });

  it('allows additional non-default households', async () => {
    const household = await createHousehold(getDb(), { name: 'Holiday home', isDefault: false });
    expect(household.isDefault).toBe(false);
  });

  it('adds and lists household members', async () => {
    const database = getDb();
    const user = await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });
    await addHouseholdMember(database, DEFAULT_HOUSEHOLD_ID, user.id);

    const members = await listHouseholdMembers(database, DEFAULT_HOUSEHOLD_ID);
    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({ householdId: DEFAULT_HOUSEHOLD_ID, userId: user.id });
  });

  it('cascades membership deletes when a user is removed', async () => {
    const database = getDb();
    const user = await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });
    await addHouseholdMember(database, DEFAULT_HOUSEHOLD_ID, user.id);

    // Deleting via the dialect-generic cast used by the repositories.
    const { eq } = await import('drizzle-orm');
    const db = database.db as import('drizzle-orm/node-postgres').NodePgDatabase<
      typeof import('../src/db/schema/pg.js')
    >;
    const t = database.schema as typeof import('../src/db/schema/pg.js');
    await db.delete(t.users).where(eq(t.users.id, user.id));

    expect(await listHouseholdMembers(database, DEFAULT_HOUSEHOLD_ID)).toHaveLength(0);
  });
}

describe('database (sqlite)', () => {
  let database: Database;

  beforeEach(async () => {
    database = connectDatabase({ dialect: 'sqlite', file: ':memory:' });
    await runMigrations(database);
    await seedDefaultHousehold(database);
  });

  afterEach(async () => {
    await database.close();
  });

  suite(() => database);
});

const postgresUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(postgresUrl === undefined)('database (postgres)', () => {
  let database: Database;

  beforeAll(async () => {
    database = connectDatabase({ dialect: 'postgres', url: postgresUrl as string });
    await runMigrations(database);
  });

  beforeEach(async () => {
    const db = database.db as import('drizzle-orm/node-postgres').NodePgDatabase<
      typeof import('../src/db/schema/pg.js')
    >;
    const t = database.schema as typeof import('../src/db/schema/pg.js');
    await db.delete(t.householdMembers);
    await db.delete(t.users);
    await db.delete(t.households);
    await seedDefaultHousehold(database);
  });

  afterAll(async () => {
    await database.close();
  });

  suite(() => database);
});

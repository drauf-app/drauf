import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase, type Database, runMigrations } from '../src/db/index.js';
import {
  addHouseholdMember,
  addListHousehold,
  addListMember,
  createHousehold,
  createList,
  createRefreshToken,
  createUser,
  deleteList,
  deleteRefreshToken,
  getDefaultHousehold,
  getListById,
  getRefreshTokenByHash,
  getUserById,
  isUserInListHousehold,
  listHouseholdMembers,
  listListsForUser,
  listRefreshTokensByUser,
  updateList,
  updateUserLoginState,
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

  it('stores and updates login state', async () => {
    const database = getDb();
    const user = await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });
    expect(user).toMatchObject({
      passwordHash: null,
      isAdmin: false,
      failedLogins: 0,
      lockedUntil: null,
    });

    const lockedUntil = new Date(Date.now() + 60_000);
    await updateUserLoginState(database, user.id, { failedLogins: 3, lockedUntil });

    const updated = await getUserById(database, user.id);
    expect(updated?.failedLogins).toBe(3);
    expect(updated?.lockedUntil).toEqual(lockedUntil);
  });

  it('creates, finds and deletes refresh tokens', async () => {
    const database = getDb();
    const user = await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });
    const token = await createRefreshToken(database, {
      userId: user.id,
      tokenHash: 'hash-1',
      deviceName: 'iPad',
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(await getRefreshTokenByHash(database, 'hash-1')).toEqual(token);
    expect(await listRefreshTokensByUser(database, user.id)).toHaveLength(1);

    await deleteRefreshToken(database, token.id);
    expect(await getRefreshTokenByHash(database, 'hash-1')).toBeUndefined();
  });

  it('cascades refresh tokens when a user is removed', async () => {
    const database = getDb();
    const user = await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });
    await createRefreshToken(database, {
      userId: user.id,
      tokenHash: 'hash-2',
      deviceName: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const { eq } = await import('drizzle-orm');
    const db = database.db as import('drizzle-orm/node-postgres').NodePgDatabase<
      typeof import('../src/db/schema/pg.js')
    >;
    const t = database.schema as typeof import('../src/db/schema/pg.js');
    await db.delete(t.users).where(eq(t.users.id, user.id));

    expect(await getRefreshTokenByHash(database, 'hash-2')).toBeUndefined();
  });

  it('stores lists with household links and memberships', async () => {
    const database = getDb();
    const user = await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });
    const list = await createList(database, {
      name: 'Weekly shop',
      icon: 'cart',
      color: '#33AA55',
      ownerId: user.id,
    });

    await addListHousehold(database, list.id, DEFAULT_HOUSEHOLD_ID);
    await addHouseholdMember(database, DEFAULT_HOUSEHOLD_ID, user.id);
    await addListMember(database, list.id, user.id);
    // Adding twice is idempotent.
    await addListMember(database, list.id, user.id);

    expect(await listListsForUser(database, user.id)).toEqual([list]);
    expect(await isUserInListHousehold(database, list.id, user.id)).toBe(true);

    await updateList(database, list.id, { name: 'Drugstore', archived: true });
    expect(await getListById(database, list.id)).toMatchObject({
      name: 'Drugstore',
      archived: true,
      icon: 'cart',
    });

    await deleteList(database, list.id);
    expect(await getListById(database, list.id)).toBeUndefined();
    expect(await listListsForUser(database, user.id)).toEqual([]);
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

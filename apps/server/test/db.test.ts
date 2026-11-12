import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectDatabase, type Database, runMigrations } from '../src/db/index.js';
import {
  addHouseholdMember,
  addListHousehold,
  addListMember,
  createEntryPortion,
  createHousehold,
  createList,
  createListEntry,
  createRefreshToken,
  createUser,
  deleteList,
  deleteListEntry,
  deleteRefreshToken,
  findMergeableEntry,
  getDefaultHousehold,
  getListById,
  getListEntry,
  getRefreshTokenByHash,
  getUserById,
  isUserInListHousehold,
  listCategories,
  listHouseholdMembers,
  listListsForUser,
  listPortionsForEntries,
  listRefreshTokensByUser,
  parseVariants,
  recordCatalogUsage,
  recordCatalogVariant,
  searchCatalogUsage,
  setCatalogUsageCategory,
  setEntryChecked,
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

  it('stores entries with portions and cascades their deletion', async () => {
    const database = getDb();
    const user = await createUser(database, { username: 'kathrin', displayName: 'Kathrin' });
    const list = await createList(database, {
      name: 'Weekly shop',
      icon: null,
      color: null,
      ownerId: user.id,
    });
    const entry = await createListEntry(database, {
      listId: list.id,
      name: 'Zwiebeln',
      nameNormalized: 'zwiebeln',
      variant: null,
      note: null,
      categoryId: null,
    });
    await createEntryPortion(database, {
      entryId: entry.id,
      quantity: 1.5,
      unit: 'kg',
      count: null,
      origin: 'manual',
      addedById: user.id,
    });

    // Variant comparison is null-safe for the merge lookup.
    expect(await findMergeableEntry(database, list.id, 'zwiebeln', null)).toEqual(entry);
    expect(await findMergeableEntry(database, list.id, 'zwiebeln', 'rot')).toBeUndefined();

    const checkedAt = new Date();
    await setEntryChecked(database, entry.id, { checkedAt, checkedById: user.id });
    expect(await findMergeableEntry(database, list.id, 'zwiebeln', null)).toBeUndefined();
    expect(await getListEntry(database, list.id, entry.id)).toMatchObject({
      checkedAt,
      checkedById: user.id,
    });

    await deleteListEntry(database, entry.id);
    expect(await listPortionsForEntries(database, [entry.id])).toEqual([]);
  });

  it('records and searches catalog usage', async () => {
    const database = getDb();
    const base = {
      name: 'Zimtschnecken',
      nameNormalized: 'zimtschnecken',
      quantity: 4,
      unit: 'Stück',
      count: null,
      variant: null,
      categoryId: null,
    };
    await recordCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, base);
    const categories = await listCategories(database, DEFAULT_HOUSEHOLD_ID);
    const categoryId = categories[0]?.id as string;
    await recordCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, {
      ...base,
      name: 'zimtschnecken',
      quantity: 6,
      categoryId,
    });
    // An add without a category must not erase the learned one.
    await recordCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, { ...base, quantity: 2 });

    const rows = await searchCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, 'zimt', 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'Zimtschnecken',
      count: 3,
      lastQuantity: 2,
      categoryId,
    });

    await setCatalogUsageCategory(database, DEFAULT_HOUSEHOLD_ID, 'zimtschnecken', null);
    expect(
      (await searchCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, 'zimt', 10))[0]?.categoryId,
    ).toBeNull();

    // Wildcards in the prefix never act as LIKE patterns.
    expect(await searchCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, '%', 10)).toEqual([]);
  });

  it('accumulates used variants most-recent-first without duplicates', async () => {
    const database = getDb();
    const base = {
      name: 'Paprika',
      nameNormalized: 'paprika',
      quantity: null,
      unit: null,
      count: null,
      categoryId: null,
    };
    await recordCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, { ...base, variant: 'rot' });
    await recordCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, { ...base, variant: 'gelb' });
    await recordCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, { ...base, variant: null });
    await recordCatalogVariant(database, DEFAULT_HOUSEHOLD_ID, 'paprika', 'rot');

    const [row] = await searchCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, 'pap', 10);
    expect(parseVariants(row?.variants ?? null)).toEqual(['rot', 'gelb']);
    expect(row?.lastVariant).toBe('rot');

    // A comma-separated variant learns each modifier on its own.
    await recordCatalogVariant(database, DEFAULT_HOUSEHOLD_ID, 'paprika', 'Bio, Festkochend');
    const [updated] = await searchCatalogUsage(database, DEFAULT_HOUSEHOLD_ID, 'pap', 10);
    expect(parseVariants(updated?.variants ?? null)).toEqual(['Bio', 'Festkochend', 'rot', 'gelb']);
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
    // lists.ownerId is ON DELETE RESTRICT, so lists must go before users.
    await db.delete(t.lists);
    await db.delete(t.users);
    await db.delete(t.households);
    await seedDefaultHousehold(database);
  });

  afterAll(async () => {
    await database.close();
  });

  suite(() => database);
});

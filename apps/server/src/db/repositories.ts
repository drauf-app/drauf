import { and, asc, desc, eq, gte, inArray, isNull, like, lt, lte } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newId } from './ids.js';
import type { Database } from './index.js';
import type * as pgSchema from './schema/pg.js';
import type {
  CatalogUsage,
  Category,
  EntryPortion,
  Household,
  HouseholdMember,
  List,
  ListEntry,
  ListMember,
  LoginCode,
  MealSlot,
  OidcTransaction,
  PlanEntry,
  PortionOrigin,
  RefreshToken,
  Store,
  User,
  UserIdentity,
} from './schema/types.js';

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
  input: {
    username: string;
    displayName: string;
    passwordHash?: string | null;
    isAdmin?: boolean;
  },
): Promise<User> {
  const { db, t } = unwrap(database);
  const user: User = {
    id: newId(),
    username: input.username,
    displayName: input.displayName,
    passwordHash: input.passwordHash ?? null,
    isAdmin: input.isAdmin ?? false,
    failedLogins: 0,
    lockedUntil: null,
    createdAt: new Date(),
  };
  await db.insert(t.users).values(user);
  return user;
}

export async function getUserById(database: Database, id: string): Promise<User | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db.select().from(t.users).where(eq(t.users.id, id));
  return rows[0];
}

export async function getUserByUsername(
  database: Database,
  username: string,
): Promise<User | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db.select().from(t.users).where(eq(t.users.username, username));
  return rows[0];
}

export async function listUsers(database: Database): Promise<User[]> {
  const { db, t } = unwrap(database);
  return db.select().from(t.users).orderBy(asc(t.users.createdAt));
}

export async function countUsers(database: Database): Promise<number> {
  const { db, t } = unwrap(database);
  const rows = await db.select({ id: t.users.id }).from(t.users);
  return rows.length;
}

export async function updateUserLoginState(
  database: Database,
  userId: string,
  state: { failedLogins: number; lockedUntil: Date | null },
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.users).set(state).where(eq(t.users.id, userId));
}

export async function createRefreshToken(
  database: Database,
  input: { userId: string; tokenHash: string; deviceName: string | null; expiresAt: Date },
): Promise<RefreshToken> {
  const { db, t } = unwrap(database);
  const now = new Date();
  const token: RefreshToken = { id: newId(), createdAt: now, lastUsedAt: now, ...input };
  await db.insert(t.refreshTokens).values(token);
  return token;
}

export async function getRefreshTokenByHash(
  database: Database,
  tokenHash: string,
): Promise<RefreshToken | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.refreshTokens)
    .where(eq(t.refreshTokens.tokenHash, tokenHash));
  return rows[0];
}

export async function deleteRefreshToken(database: Database, id: string): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.refreshTokens).where(eq(t.refreshTokens.id, id));
}

export async function listRefreshTokensByUser(
  database: Database,
  userId: string,
): Promise<RefreshToken[]> {
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.refreshTokens)
    .where(eq(t.refreshTokens.userId, userId))
    .orderBy(asc(t.refreshTokens.createdAt));
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

export async function createUserIdentity(
  database: Database,
  input: { userId: string; issuer: string; subject: string },
): Promise<UserIdentity> {
  const { db, t } = unwrap(database);
  const identity: UserIdentity = { id: newId(), createdAt: new Date(), ...input };
  await db.insert(t.userIdentities).values(identity);
  return identity;
}

export async function getUserIdentity(
  database: Database,
  issuer: string,
  subject: string,
): Promise<UserIdentity | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.userIdentities)
    .where(and(eq(t.userIdentities.issuer, issuer), eq(t.userIdentities.subject, subject)));
  return rows[0];
}

export async function createOidcTransaction(
  database: Database,
  transaction: OidcTransaction,
): Promise<void> {
  const { db, t } = unwrap(database);
  // Opportunistic cleanup keeps the table from accumulating abandoned rows.
  await db.delete(t.oidcTransactions).where(lt(t.oidcTransactions.expiresAt, new Date()));
  await db.insert(t.oidcTransactions).values(transaction);
}

/** Returns and deletes the transaction: every state value is usable once. */
export async function consumeOidcTransaction(
  database: Database,
  state: string,
): Promise<OidcTransaction | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.oidcTransactions)
    .where(eq(t.oidcTransactions.state, state));
  const transaction = rows[0];
  if (transaction === undefined) {
    return undefined;
  }
  await db.delete(t.oidcTransactions).where(eq(t.oidcTransactions.state, state));
  return transaction.expiresAt > new Date() ? transaction : undefined;
}

export async function createLoginCode(
  database: Database,
  input: { codeHash: string; userId: string; deviceName: string | null; expiresAt: Date },
): Promise<LoginCode> {
  const { db, t } = unwrap(database);
  await db.delete(t.loginCodes).where(lt(t.loginCodes.expiresAt, new Date()));
  const code: LoginCode = { id: newId(), createdAt: new Date(), ...input };
  await db.insert(t.loginCodes).values(code);
  return code;
}

/** Returns and deletes the login code: single use. */
export async function consumeLoginCode(
  database: Database,
  codeHash: string,
): Promise<LoginCode | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db.select().from(t.loginCodes).where(eq(t.loginCodes.codeHash, codeHash));
  const code = rows[0];
  if (code === undefined) {
    return undefined;
  }
  await db.delete(t.loginCodes).where(eq(t.loginCodes.id, code.id));
  return code.expiresAt > new Date() ? code : undefined;
}

export async function setUserAdmin(
  database: Database,
  userId: string,
  isAdmin: boolean,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.users).set({ isAdmin }).where(eq(t.users.id, userId));
}

export async function createList(
  database: Database,
  input: { name: string; icon: string | null; color: string | null; ownerId: string },
): Promise<List> {
  const { db, t } = unwrap(database);
  const list: List = {
    id: newId(),
    archived: false,
    defaultStoreId: null,
    createdAt: new Date(),
    ...input,
  };
  await db.insert(t.lists).values(list);
  return list;
}

export async function getListById(database: Database, id: string): Promise<List | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db.select().from(t.lists).where(eq(t.lists.id, id));
  return rows[0];
}

/** All lists the user is a member of, oldest first. */
export async function listListsForUser(database: Database, userId: string): Promise<List[]> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select({ list: t.lists })
    .from(t.listMembers)
    .innerJoin(t.lists, eq(t.listMembers.listId, t.lists.id))
    .where(eq(t.listMembers.userId, userId))
    .orderBy(asc(t.lists.createdAt));
  return rows.map((row) => row.list);
}

export async function updateList(
  database: Database,
  id: string,
  patch: Partial<Pick<List, 'name' | 'icon' | 'color' | 'archived' | 'defaultStoreId'>>,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.lists).set(patch).where(eq(t.lists.id, id));
}

export async function deleteList(database: Database, id: string): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.lists).where(eq(t.lists.id, id));
}

export async function addListHousehold(
  database: Database,
  listId: string,
  householdId: string,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.insert(t.listHouseholds).values({ listId, householdId, createdAt: new Date() });
}

export async function addListMember(
  database: Database,
  listId: string,
  userId: string,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db
    .insert(t.listMembers)
    .values({ listId, userId, createdAt: new Date() })
    .onConflictDoNothing();
}

export async function removeListMember(
  database: Database,
  listId: string,
  userId: string,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db
    .delete(t.listMembers)
    .where(and(eq(t.listMembers.listId, listId), eq(t.listMembers.userId, userId)));
}

export async function getListMember(
  database: Database,
  listId: string,
  userId: string,
): Promise<ListMember | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.listMembers)
    .where(and(eq(t.listMembers.listId, listId), eq(t.listMembers.userId, userId)));
  return rows[0];
}

export interface ListMemberUser {
  userId: string;
  username: string;
  displayName: string;
}

export async function listHouseholdMemberUsers(
  database: Database,
  householdId: string,
): Promise<ListMemberUser[]> {
  const { db, t } = unwrap(database);
  return db
    .select({
      userId: t.householdMembers.userId,
      username: t.users.username,
      displayName: t.users.displayName,
    })
    .from(t.householdMembers)
    .innerJoin(t.users, eq(t.householdMembers.userId, t.users.id))
    .where(eq(t.householdMembers.householdId, householdId))
    .orderBy(asc(t.householdMembers.createdAt));
}

export async function listListMemberUsers(
  database: Database,
  listId: string,
): Promise<ListMemberUser[]> {
  const { db, t } = unwrap(database);
  return db
    .select({
      userId: t.listMembers.userId,
      username: t.users.username,
      displayName: t.users.displayName,
    })
    .from(t.listMembers)
    .innerJoin(t.users, eq(t.listMembers.userId, t.users.id))
    .where(eq(t.listMembers.listId, listId))
    .orderBy(asc(t.listMembers.createdAt));
}

export async function createListEntry(
  database: Database,
  input: {
    listId: string;
    name: string;
    nameNormalized: string;
    variant: string | null;
    note: string | null;
    categoryId: string | null;
  },
): Promise<ListEntry> {
  const { db, t } = unwrap(database);
  const entry: ListEntry = {
    id: newId(),
    fieldTimes: null,
    checkedAt: null,
    checkedById: null,
    createdAt: new Date(),
    ...input,
  };
  await db.insert(t.listEntries).values(entry);
  return entry;
}

/** Scoped by list id so callers cannot reach entries of foreign lists. */
export async function getListEntry(
  database: Database,
  listId: string,
  entryId: string,
): Promise<ListEntry | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.listEntries)
    .where(and(eq(t.listEntries.id, entryId), eq(t.listEntries.listId, listId)));
  return rows[0];
}

/** The unchecked entry a new addition of the same item merges into, if any. */
export async function findMergeableEntry(
  database: Database,
  listId: string,
  nameNormalized: string,
  variant: string | null,
): Promise<ListEntry | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.listEntries)
    .where(
      and(
        eq(t.listEntries.listId, listId),
        eq(t.listEntries.nameNormalized, nameNormalized),
        variant === null ? isNull(t.listEntries.variant) : eq(t.listEntries.variant, variant),
        isNull(t.listEntries.checkedAt),
      ),
    );
  return rows[0];
}

export async function listEntriesForList(database: Database, listId: string): Promise<ListEntry[]> {
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.listEntries)
    .where(eq(t.listEntries.listId, listId))
    .orderBy(asc(t.listEntries.createdAt));
}

export async function updateListEntry(
  database: Database,
  entryId: string,
  patch: Partial<
    Pick<ListEntry, 'name' | 'nameNormalized' | 'variant' | 'note' | 'categoryId' | 'fieldTimes'>
  >,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.listEntries).set(patch).where(eq(t.listEntries.id, entryId));
}

export async function setEntryChecked(
  database: Database,
  entryId: string,
  checked: { checkedAt: Date | null; checkedById: string | null },
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.listEntries).set(checked).where(eq(t.listEntries.id, entryId));
}

export async function deleteListEntry(database: Database, entryId: string): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.listEntries).where(eq(t.listEntries.id, entryId));
}

export async function createEntryPortion(
  database: Database,
  input: {
    entryId: string;
    quantity: number | null;
    unit: string | null;
    origin: PortionOrigin;
    addedById: string | null;
  },
): Promise<EntryPortion> {
  const { db, t } = unwrap(database);
  const portion: EntryPortion = { id: newId(), createdAt: new Date(), ...input };
  await db.insert(t.entryPortions).values(portion);
  return portion;
}

export async function listPortionsForEntries(
  database: Database,
  entryIds: string[],
): Promise<EntryPortion[]> {
  if (entryIds.length === 0) {
    return [];
  }
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.entryPortions)
    .where(inArray(t.entryPortions.entryId, entryIds))
    .orderBy(asc(t.entryPortions.createdAt));
}

export async function deletePortionsForEntry(database: Database, entryId: string): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.entryPortions).where(eq(t.entryPortions.entryId, entryId));
}

export async function isHouseholdMember(
  database: Database,
  householdId: string,
  userId: string,
): Promise<boolean> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select({ userId: t.householdMembers.userId })
    .from(t.householdMembers)
    .where(
      and(eq(t.householdMembers.householdId, householdId), eq(t.householdMembers.userId, userId)),
    );
  return rows.length > 0;
}

export async function createCategory(
  database: Database,
  input: { householdId: string; key: string | null; name: string; sortOrder: number },
): Promise<Category> {
  const { db, t } = unwrap(database);
  const category: Category = { id: newId(), createdAt: new Date(), ...input };
  await db.insert(t.categories).values(category);
  return category;
}

export async function listCategories(database: Database, householdId: string): Promise<Category[]> {
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.categories)
    .where(eq(t.categories.householdId, householdId))
    .orderBy(asc(t.categories.sortOrder), asc(t.categories.createdAt));
}

/** Scoped by household so callers cannot reach foreign categories. */
export async function getCategory(
  database: Database,
  householdId: string,
  categoryId: string,
): Promise<Category | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.categories)
    .where(and(eq(t.categories.id, categoryId), eq(t.categories.householdId, householdId)));
  return rows[0];
}

export async function updateCategory(
  database: Database,
  categoryId: string,
  patch: Partial<Pick<Category, 'name' | 'sortOrder'>>,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.categories).set(patch).where(eq(t.categories.id, categoryId));
}

export async function deleteCategory(database: Database, categoryId: string): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.categories).where(eq(t.categories.id, categoryId));
}

export async function createStore(
  database: Database,
  input: { householdId: string; name: string },
): Promise<Store> {
  const { db, t } = unwrap(database);
  const store: Store = { id: newId(), createdAt: new Date(), ...input };
  await db.insert(t.stores).values(store);
  return store;
}

export async function listStores(database: Database, householdId: string): Promise<Store[]> {
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.stores)
    .where(eq(t.stores.householdId, householdId))
    .orderBy(asc(t.stores.createdAt));
}

/** Scoped by household so callers cannot reach foreign stores. */
export async function getStore(
  database: Database,
  householdId: string,
  storeId: string,
): Promise<Store | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.stores)
    .where(and(eq(t.stores.id, storeId), eq(t.stores.householdId, householdId)));
  return rows[0];
}

export async function updateStore(
  database: Database,
  storeId: string,
  patch: Partial<Pick<Store, 'name'>>,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.stores).set(patch).where(eq(t.stores.id, storeId));
}

export async function deleteStore(database: Database, storeId: string): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.stores).where(eq(t.stores.id, storeId));
}

/** Replaces the store's category order with the given sequence. */
export async function replaceStoreCategoryOrder(
  database: Database,
  storeId: string,
  categoryIds: string[],
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.storeCategories).where(eq(t.storeCategories.storeId, storeId));
  if (categoryIds.length > 0) {
    await db
      .insert(t.storeCategories)
      .values(categoryIds.map((categoryId, position) => ({ storeId, categoryId, position })));
  }
}

export async function getStoreCategoryOrder(
  database: Database,
  storeId: string,
): Promise<string[]> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select({ categoryId: t.storeCategories.categoryId })
    .from(t.storeCategories)
    .where(eq(t.storeCategories.storeId, storeId))
    .orderBy(asc(t.storeCategories.position));
  return rows.map((row) => row.categoryId);
}

export async function createMealSlot(
  database: Database,
  input: { householdId: string; name: string; sortOrder: number },
): Promise<MealSlot> {
  const { db, t } = unwrap(database);
  const slot: MealSlot = { id: newId(), createdAt: new Date(), ...input };
  await db.insert(t.mealSlots).values(slot);
  return slot;
}

export async function listMealSlots(database: Database, householdId: string): Promise<MealSlot[]> {
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.mealSlots)
    .where(eq(t.mealSlots.householdId, householdId))
    .orderBy(asc(t.mealSlots.sortOrder), asc(t.mealSlots.createdAt));
}

/** Scoped by household so callers cannot reach foreign slots. */
export async function getMealSlot(
  database: Database,
  householdId: string,
  slotId: string,
): Promise<MealSlot | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.mealSlots)
    .where(and(eq(t.mealSlots.id, slotId), eq(t.mealSlots.householdId, householdId)));
  return rows[0];
}

export async function updateMealSlot(
  database: Database,
  slotId: string,
  patch: Partial<Pick<MealSlot, 'name' | 'sortOrder'>>,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.mealSlots).set(patch).where(eq(t.mealSlots.id, slotId));
}

export async function deleteMealSlot(database: Database, slotId: string): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.mealSlots).where(eq(t.mealSlots.id, slotId));
}

export async function createPlanEntry(
  database: Database,
  input: {
    householdId: string;
    date: string;
    slotId: string;
    text: string | null;
    link: string | null;
    imageUrl: string | null;
    cookId: string | null;
  },
): Promise<PlanEntry> {
  const { db, t } = unwrap(database);
  const entry: PlanEntry = { id: newId(), createdAt: new Date(), ...input };
  await db.insert(t.planEntries).values(entry);
  return entry;
}

/** Scoped by household so callers cannot reach foreign plan entries. */
export async function getPlanEntry(
  database: Database,
  householdId: string,
  entryId: string,
): Promise<PlanEntry | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.planEntries)
    .where(and(eq(t.planEntries.id, entryId), eq(t.planEntries.householdId, householdId)));
  return rows[0];
}

export async function findPlanEntryForSlot(
  database: Database,
  householdId: string,
  date: string,
  slotId: string,
): Promise<PlanEntry | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.planEntries)
    .where(
      and(
        eq(t.planEntries.householdId, householdId),
        eq(t.planEntries.date, date),
        eq(t.planEntries.slotId, slotId),
      ),
    );
  return rows[0];
}

export async function listPlanEntries(
  database: Database,
  householdId: string,
  from: string,
  to: string,
): Promise<PlanEntry[]> {
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.planEntries)
    .where(
      and(
        eq(t.planEntries.householdId, householdId),
        gte(t.planEntries.date, from),
        lte(t.planEntries.date, to),
      ),
    )
    .orderBy(asc(t.planEntries.date), asc(t.planEntries.createdAt));
}

export async function updatePlanEntry(
  database: Database,
  entryId: string,
  patch: Partial<Pick<PlanEntry, 'date' | 'slotId' | 'text' | 'link' | 'imageUrl' | 'cookId'>>,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db.update(t.planEntries).set(patch).where(eq(t.planEntries.id, entryId));
}

export async function deletePlanEntry(database: Database, entryId: string): Promise<void> {
  const { db, t } = unwrap(database);
  await db.delete(t.planEntries).where(eq(t.planEntries.id, entryId));
}

/** Records a processed sync operation id; returns false when it was already known. */
export async function markOperationApplied(
  database: Database,
  operationId: string,
  userId: string,
): Promise<boolean> {
  const { db, t } = unwrap(database);
  try {
    await db.insert(t.appliedOperations).values({
      id: operationId,
      userId,
      appliedAt: new Date(),
    });
    return true;
  } catch {
    return false;
  }
}

export async function isOperationApplied(
  database: Database,
  operationId: string,
): Promise<boolean> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select({ id: t.appliedOperations.id })
    .from(t.appliedOperations)
    .where(eq(t.appliedOperations.id, operationId));
  return rows.length > 0;
}

/** The household a list is attached to (the default household in the MVP). */
export async function getListHouseholdId(
  database: Database,
  listId: string,
): Promise<string | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select({ householdId: t.listHouseholds.householdId })
    .from(t.listHouseholds)
    .where(eq(t.listHouseholds.listId, listId));
  return rows[0]?.householdId;
}

/** Bumps the household's shopping history for an item (K4 learning). */
/** How many recently used variants are kept per item for the custom chips. */
const MAX_LEARNED_VARIANTS = 6;

/** Parses the stored JSON list of recently used variants. */
export function parseVariants(raw: string | null): string[] {
  if (raw === null) {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

function pushVariant(raw: string | null, variant: string): string {
  const next = [variant, ...parseVariants(raw).filter((value) => value !== variant)];
  return JSON.stringify(next.slice(0, MAX_LEARNED_VARIANTS));
}

export async function recordCatalogUsage(
  database: Database,
  householdId: string,
  input: {
    name: string;
    nameNormalized: string;
    quantity: number | null;
    unit: string | null;
    variant: string | null;
    categoryId: string | null;
  },
): Promise<void> {
  const { db, t } = unwrap(database);
  const key = and(
    eq(t.catalogUsage.householdId, householdId),
    eq(t.catalogUsage.nameNormalized, input.nameNormalized),
  );
  const existing = (await db.select().from(t.catalogUsage).where(key))[0];
  const now = new Date();
  if (existing === undefined) {
    await db.insert(t.catalogUsage).values({
      householdId,
      nameNormalized: input.nameNormalized,
      name: input.name,
      count: 1,
      categoryId: input.categoryId,
      lastQuantity: input.quantity,
      lastUnit: input.unit,
      lastVariant: input.variant,
      variants: input.variant === null ? null : JSON.stringify([input.variant]),
      updatedAt: now,
    });
  } else {
    await db
      .update(t.catalogUsage)
      .set({
        name: input.name,
        count: existing.count + 1,
        // A learned category survives adds without one.
        categoryId: input.categoryId ?? existing.categoryId,
        lastQuantity: input.quantity,
        lastUnit: input.unit,
        lastVariant: input.variant,
        // Used variants accumulate; adds without one keep the learned list.
        variants:
          input.variant === null
            ? existing.variants
            : pushVariant(existing.variants, input.variant),
        updatedAt: now,
      })
      .where(key);
  }
}

/** The household's history row for one normalized item name, if any. */
export async function getCatalogUsage(
  database: Database,
  householdId: string,
  nameNormalized: string,
): Promise<CatalogUsage | undefined> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select()
    .from(t.catalogUsage)
    .where(
      and(
        eq(t.catalogUsage.householdId, householdId),
        eq(t.catalogUsage.nameNormalized, nameNormalized),
      ),
    );
  return rows[0];
}

/** Remembers a variant applied after the add (chips, edits), if a row exists. */
export async function recordCatalogVariant(
  database: Database,
  householdId: string,
  nameNormalized: string,
  variant: string,
): Promise<void> {
  const existing = await getCatalogUsage(database, householdId, nameNormalized);
  if (existing === undefined) {
    return;
  }
  const { db, t } = unwrap(database);
  await db
    .update(t.catalogUsage)
    .set({ lastVariant: variant, variants: pushVariant(existing.variants, variant) })
    .where(
      and(
        eq(t.catalogUsage.householdId, householdId),
        eq(t.catalogUsage.nameNormalized, nameNormalized),
      ),
    );
}

/** Remembers the category chosen for an item, when a history row exists. */
export async function setCatalogUsageCategory(
  database: Database,
  householdId: string,
  nameNormalized: string,
  categoryId: string | null,
): Promise<void> {
  const { db, t } = unwrap(database);
  await db
    .update(t.catalogUsage)
    .set({ categoryId })
    .where(
      and(
        eq(t.catalogUsage.householdId, householdId),
        eq(t.catalogUsage.nameNormalized, nameNormalized),
      ),
    );
}

function escapeLikePrefix(prefix: string): string {
  // SQLite LIKE has no default ESCAPE character, so wildcards are stripped
  // instead of escaped; item names never contain them anyway.
  return prefix.replace(/[\\%_]/g, '');
}

/** Household history matching the normalized prefix, most-used first. */
export async function searchCatalogUsage(
  database: Database,
  householdId: string,
  normalizedPrefix: string,
  limit: number,
): Promise<CatalogUsage[]> {
  const prefix = escapeLikePrefix(normalizedPrefix);
  if (prefix === '') {
    return [];
  }
  const { db, t } = unwrap(database);
  return db
    .select()
    .from(t.catalogUsage)
    .where(
      and(
        eq(t.catalogUsage.householdId, householdId),
        like(t.catalogUsage.nameNormalized, `${prefix}%`),
      ),
    )
    .orderBy(desc(t.catalogUsage.count), desc(t.catalogUsage.updatedAt))
    .limit(limit);
}

/** Whether the store belongs to a household the list is attached to. */
export async function isStoreLinkedToList(
  database: Database,
  listId: string,
  storeId: string,
): Promise<boolean> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select({ id: t.stores.id })
    .from(t.stores)
    .innerJoin(
      t.listHouseholds,
      and(
        eq(t.listHouseholds.householdId, t.stores.householdId),
        eq(t.listHouseholds.listId, listId),
      ),
    )
    .where(eq(t.stores.id, storeId));
  return rows.length > 0;
}

/** Whether the category belongs to a household the list is attached to. */
export async function isCategoryLinkedToList(
  database: Database,
  listId: string,
  categoryId: string,
): Promise<boolean> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select({ id: t.categories.id })
    .from(t.categories)
    .innerJoin(
      t.listHouseholds,
      and(
        eq(t.listHouseholds.householdId, t.categories.householdId),
        eq(t.listHouseholds.listId, listId),
      ),
    )
    .where(eq(t.categories.id, categoryId));
  return rows.length > 0;
}

/** Whether the user belongs to any household the list is attached to. */
export async function isUserInListHousehold(
  database: Database,
  listId: string,
  userId: string,
): Promise<boolean> {
  const { db, t } = unwrap(database);
  const rows = await db
    .select({ householdId: t.listHouseholds.householdId })
    .from(t.listHouseholds)
    .innerJoin(
      t.householdMembers,
      and(
        eq(t.listHouseholds.householdId, t.householdMembers.householdId),
        eq(t.householdMembers.userId, userId),
      ),
    )
    .where(eq(t.listHouseholds.listId, listId));
  return rows.length > 0;
}

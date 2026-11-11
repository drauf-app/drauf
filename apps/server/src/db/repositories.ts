import { and, asc, eq, lt } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newId } from './ids.js';
import type { Database } from './index.js';
import type * as pgSchema from './schema/pg.js';
import type {
  Household,
  HouseholdMember,
  List,
  ListMember,
  LoginCode,
  OidcTransaction,
  RefreshToken,
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
  const list: List = { id: newId(), archived: false, createdAt: new Date(), ...input };
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
  patch: Partial<Pick<List, 'name' | 'icon' | 'color' | 'archived'>>,
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

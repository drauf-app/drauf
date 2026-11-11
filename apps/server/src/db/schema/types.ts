/**
 * Dialect-independent row types. Both the Postgres and the SQLite schema must
 * produce exactly these shapes; the assertions at the bottom fail the build
 * when the schemas drift apart.
 */

export interface User {
  id: string;
  username: string;
  displayName: string;
  /** Null for accounts that sign in via OIDC only. */
  passwordHash: string | null;
  isAdmin: boolean;
  failedLogins: number;
  lockedUntil: Date | null;
  createdAt: Date;
}

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
}

export interface UserIdentity {
  id: string;
  userId: string;
  issuer: string;
  subject: string;
  createdAt: Date;
}

export interface OidcTransaction {
  state: string;
  codeVerifier: string;
  nonce: string;
  clientRedirect: string;
  deviceName: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface LoginCode {
  id: string;
  codeHash: string;
  userId: string;
  deviceName: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface Household {
  id: string;
  name: string;
  isDefault: boolean;
  createdAt: Date;
}

export interface HouseholdMember {
  householdId: string;
  userId: string;
  createdAt: Date;
}

export interface Category {
  id: string;
  householdId: string;
  /** Stable identifier of seeded base categories; null for household-created ones. */
  key: string | null;
  name: string;
  sortOrder: number;
  createdAt: Date;
}

export interface Store {
  id: string;
  householdId: string;
  name: string;
  createdAt: Date;
}

export interface StoreCategory {
  storeId: string;
  categoryId: string;
  position: number;
}

export interface MealSlot {
  id: string;
  householdId: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
}

export interface PlanEntry {
  id: string;
  householdId: string;
  /** ISO calendar date (YYYY-MM-DD). */
  date: string;
  slotId: string;
  text: string | null;
  link: string | null;
  cookId: string | null;
  createdAt: Date;
}

export interface AppliedOperation {
  id: string;
  userId: string;
  appliedAt: Date;
}

export type PortionOrigin = 'manual' | 'recipe';

export interface ListEntry {
  id: string;
  listId: string;
  name: string;
  nameNormalized: string;
  variant: string | null;
  note: string | null;
  categoryId: string | null;
  /** JSON object of per-field last-write times (epoch ms) for sync LWW. */
  fieldTimes: string | null;
  checkedAt: Date | null;
  checkedById: string | null;
  createdAt: Date;
}

export interface EntryPortion {
  id: string;
  entryId: string;
  quantity: number | null;
  unit: string | null;
  origin: PortionOrigin;
  addedById: string | null;
  createdAt: Date;
}

export interface List {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
  ownerId: string;
  defaultStoreId: string | null;
  createdAt: Date;
}

export interface ListHousehold {
  listId: string;
  householdId: string;
  createdAt: Date;
}

export interface ListMember {
  listId: string;
  userId: string;
  createdAt: Date;
}

import type * as pg from './pg.js';
import type * as sqlite from './sqlite.js';

type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

type _PgUser = Assert<Eq<typeof pg.users.$inferSelect, User>>;
type _PgUserIdentity = Assert<Eq<typeof pg.userIdentities.$inferSelect, UserIdentity>>;
type _PgOidcTransaction = Assert<Eq<typeof pg.oidcTransactions.$inferSelect, OidcTransaction>>;
type _PgLoginCode = Assert<Eq<typeof pg.loginCodes.$inferSelect, LoginCode>>;
type _PgCategory = Assert<Eq<typeof pg.categories.$inferSelect, Category>>;
type _PgStore = Assert<Eq<typeof pg.stores.$inferSelect, Store>>;
type _PgStoreCategory = Assert<Eq<typeof pg.storeCategories.$inferSelect, StoreCategory>>;
type _SqliteCategory = Assert<Eq<typeof sqlite.categories.$inferSelect, Category>>;
type _SqliteStore = Assert<Eq<typeof sqlite.stores.$inferSelect, Store>>;
type _SqliteStoreCategory = Assert<Eq<typeof sqlite.storeCategories.$inferSelect, StoreCategory>>;
type _PgAppliedOperation = Assert<Eq<typeof pg.appliedOperations.$inferSelect, AppliedOperation>>;
type _SqliteAppliedOperation = Assert<
  Eq<typeof sqlite.appliedOperations.$inferSelect, AppliedOperation>
>;
type _PgMealSlot = Assert<Eq<typeof pg.mealSlots.$inferSelect, MealSlot>>;
type _PgPlanEntry = Assert<Eq<typeof pg.planEntries.$inferSelect, PlanEntry>>;
type _SqliteMealSlot = Assert<Eq<typeof sqlite.mealSlots.$inferSelect, MealSlot>>;
type _SqlitePlanEntry = Assert<Eq<typeof sqlite.planEntries.$inferSelect, PlanEntry>>;
type _PgListEntry = Assert<Eq<typeof pg.listEntries.$inferSelect, ListEntry>>;
type _PgEntryPortion = Assert<Eq<typeof pg.entryPortions.$inferSelect, EntryPortion>>;
type _SqliteListEntry = Assert<Eq<typeof sqlite.listEntries.$inferSelect, ListEntry>>;
type _SqliteEntryPortion = Assert<Eq<typeof sqlite.entryPortions.$inferSelect, EntryPortion>>;
type _PgList = Assert<Eq<typeof pg.lists.$inferSelect, List>>;
type _PgListHousehold = Assert<Eq<typeof pg.listHouseholds.$inferSelect, ListHousehold>>;
type _PgListMember = Assert<Eq<typeof pg.listMembers.$inferSelect, ListMember>>;
type _SqliteList = Assert<Eq<typeof sqlite.lists.$inferSelect, List>>;
type _SqliteListHousehold = Assert<Eq<typeof sqlite.listHouseholds.$inferSelect, ListHousehold>>;
type _SqliteListMember = Assert<Eq<typeof sqlite.listMembers.$inferSelect, ListMember>>;
type _SqliteUserIdentity = Assert<Eq<typeof sqlite.userIdentities.$inferSelect, UserIdentity>>;
type _SqliteOidcTransaction = Assert<
  Eq<typeof sqlite.oidcTransactions.$inferSelect, OidcTransaction>
>;
type _SqliteLoginCode = Assert<Eq<typeof sqlite.loginCodes.$inferSelect, LoginCode>>;
type _PgRefreshToken = Assert<Eq<typeof pg.refreshTokens.$inferSelect, RefreshToken>>;
type _PgHousehold = Assert<Eq<typeof pg.households.$inferSelect, Household>>;
type _PgHouseholdMember = Assert<Eq<typeof pg.householdMembers.$inferSelect, HouseholdMember>>;
type _SqliteUser = Assert<Eq<typeof sqlite.users.$inferSelect, User>>;
type _SqliteRefreshToken = Assert<Eq<typeof sqlite.refreshTokens.$inferSelect, RefreshToken>>;
type _SqliteHousehold = Assert<Eq<typeof sqlite.households.$inferSelect, Household>>;
type _SqliteHouseholdMember = Assert<
  Eq<typeof sqlite.householdMembers.$inferSelect, HouseholdMember>
>;

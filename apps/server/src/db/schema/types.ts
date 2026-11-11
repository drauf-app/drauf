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

import type * as pg from './pg.js';
import type * as sqlite from './sqlite.js';

type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

type _PgUser = Assert<Eq<typeof pg.users.$inferSelect, User>>;
type _PgRefreshToken = Assert<Eq<typeof pg.refreshTokens.$inferSelect, RefreshToken>>;
type _PgHousehold = Assert<Eq<typeof pg.households.$inferSelect, Household>>;
type _PgHouseholdMember = Assert<Eq<typeof pg.householdMembers.$inferSelect, HouseholdMember>>;
type _SqliteUser = Assert<Eq<typeof sqlite.users.$inferSelect, User>>;
type _SqliteRefreshToken = Assert<Eq<typeof sqlite.refreshTokens.$inferSelect, RefreshToken>>;
type _SqliteHousehold = Assert<Eq<typeof sqlite.households.$inferSelect, Household>>;
type _SqliteHouseholdMember = Assert<
  Eq<typeof sqlite.householdMembers.$inferSelect, HouseholdMember>
>;

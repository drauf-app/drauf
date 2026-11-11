import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Mirrors schema/pg.ts; both must infer the row types in schema/types.ts.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  // Null for accounts that sign in via OIDC only.
  passwordHash: text('password_hash'),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull(),
  failedLogins: integer('failed_logins').notNull(),
  lockedUntil: integer('locked_until', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Only a hash of the token is stored; the token itself exists client-side only.
  tokenHash: text('token_hash').notNull().unique(),
  deviceName: text('device_name'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

export const households = sqliteTable(
  'households',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('households_one_default_idx').on(t.isDefault).where(sql`${t.isDefault}`)],
);

export const householdMembers = sqliteTable(
  'household_members',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);

/** Links an OIDC identity (issuer + subject) to a local user account. */
export const userIdentities = sqliteTable(
  'user_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('user_identities_issuer_subject_idx').on(t.issuer, t.subject)],
);

/** Pending OIDC authorization round-trips, keyed by the state parameter. */
export const oidcTransactions = sqliteTable('oidc_transactions', {
  state: text('state').primaryKey(),
  codeVerifier: text('code_verifier').notNull(),
  nonce: text('nonce').notNull(),
  clientRedirect: text('client_redirect').notNull(),
  deviceName: text('device_name'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

/** One-time codes handed to the client after the OIDC callback; stored hashed. */
export const loginCodes = sqliteTable('login_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceName: text('device_name'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

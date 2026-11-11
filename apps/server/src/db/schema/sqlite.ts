import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

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

export const lists = sqliteTable('lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color'),
  archived: integer('archived', { mode: 'boolean' }).notNull(),
  // No cascade: deleting a user must never silently delete a shared list.
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Lists belong to households n:m; in the MVP always the default household. */
export const listHouseholds = sqliteTable(
  'list_households',
  {
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.householdId] })],
);

export const listMembers = sqliteTable(
  'list_members',
  {
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.userId] })],
);

/** One row per distinct item on a list; quantities live in entryPortions. */
export const listEntries = sqliteTable(
  'list_entries',
  {
    id: text('id').primaryKey(),
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Merge key (with variant): lowercased, whitespace-collapsed name. */
    nameNormalized: text('name_normalized').notNull(),
    variant: text('variant'),
    note: text('note'),
    checkedAt: integer('checked_at', { mode: 'timestamp_ms' }),
    checkedById: text('checked_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('list_entries_list_name_idx').on(t.listId, t.nameNormalized)],
);

/** One partial quantity of an entry, with its origin kept traceable (L4). */
export const entryPortions = sqliteTable('entry_portions', {
  id: text('id').primaryKey(),
  entryId: text('entry_id')
    .notNull()
    .references(() => listEntries.id, { onDelete: 'cascade' }),
  quantity: real('quantity'),
  unit: text('unit'),
  origin: text('origin', { enum: ['manual', 'recipe'] }).notNull(),
  addedById: text('added_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
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

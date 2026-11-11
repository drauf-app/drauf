import { sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// No database-side defaults: values are set in code so that insert behaviour
// stays identical across dialects (see schema/types.ts).

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  // Null for accounts that sign in via OIDC only.
  passwordHash: text('password_hash'),
  isAdmin: boolean('is_admin').notNull(),
  failedLogins: integer('failed_logins').notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true, mode: 'date' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  // Only a hash of the token is stored; the token itself exists client-side only.
  tokenHash: text('token_hash').notNull().unique(),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const households = pgTable(
  'households',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    isDefault: boolean('is_default').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [uniqueIndex('households_one_default_idx').on(t.isDefault).where(sql`${t.isDefault}`)],
);

export const householdMembers = pgTable(
  'household_members',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] })],
);

/** Links an OIDC identity (issuer + subject) to a local user account. */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [uniqueIndex('user_identities_issuer_subject_idx').on(t.issuer, t.subject)],
);

/** Pending OIDC authorization round-trips, keyed by the state parameter. */
export const oidcTransactions = pgTable('oidc_transactions', {
  state: text('state').primaryKey(),
  codeVerifier: text('code_verifier').notNull(),
  nonce: text('nonce').notNull(),
  clientRedirect: text('client_redirect').notNull(),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

export const lists = pgTable('lists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  icon: text('icon'),
  color: text('color'),
  archived: boolean('archived').notNull(),
  // No cascade: deleting a user must never silently delete a shared list.
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
});

/** Lists belong to households n:m; in the MVP always the default household. */
export const listHouseholds = pgTable(
  'list_households',
  {
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.householdId] })],
);

export const listMembers = pgTable(
  'list_members',
  {
    listId: text('list_id')
      .notNull()
      .references(() => lists.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.listId, t.userId] })],
);

/** One-time codes handed to the client after the OIDC callback; stored hashed. */
export const loginCodes = pgTable('login_codes', {
  id: text('id').primaryKey(),
  codeHash: text('code_hash').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

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
    /** JSON array of staple names for the import preselection; null = defaults. */
    staples: text('staples'),
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
  /** The store preselected while shopping (L7); switching re-sorts the list. */
  defaultStoreId: text('default_store_id').references(() => stores.id, { onDelete: 'set null' }),
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

/**
 * Shopping categories per household. The seeded base set carries a stable
 * `key` (referenced by the item catalogue later) and cannot be deleted;
 * household-created categories have no key.
 */
export const categories = sqliteTable(
  'categories',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    key: text('key'),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('categories_household_key_idx')
      .on(t.householdId, t.key)
      .where(sql`${t.key} IS NOT NULL`),
  ],
);

/** Stores are first-class household objects, each with its own category order. */
export const stores = sqliteTable('stores', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Per-store category order (drag & drop); categories not listed follow the default order. */
export const storeCategories = sqliteTable(
  'store_categories',
  {
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.categoryId] })],
);

/** Meal slots of a household's weekly plan (W2), e.g. lunch and dinner. */
export const mealSlots = sqliteTable('meal_slots', {
  id: text('id').primaryKey(),
  householdId: text('household_id')
    .notNull()
    .references(() => households.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/** One plan entry per day and slot: free text or a recipe link, plus who cooks. */
export const planEntries = sqliteTable(
  'plan_entries',
  {
    id: text('id').primaryKey(),
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** ISO calendar date (YYYY-MM-DD); text keeps it identical across dialects. */
    date: text('date').notNull(),
    slotId: text('slot_id')
      .notNull()
      .references(() => mealSlots.id, { onDelete: 'cascade' }),
    text: text('text'),
    link: text('link'),
    /** Preview image of the linked recipe (W4); always shown via the proxy. */
    imageUrl: text('image_url'),
    cookId: text('cook_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('plan_entries_day_slot_idx').on(t.householdId, t.date, t.slotId)],
);

/**
 * Household shopping history per item name (K3 + K4): learning store for
 * suggestions and, for items unknown to the base catalogue, the household
 * catalogue itself (the row carries the learned category).
 */
export const catalogUsage = sqliteTable(
  'catalog_usage',
  {
    householdId: text('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    nameNormalized: text('name_normalized').notNull(),
    /** Last-used display spelling. */
    name: text('name').notNull(),
    count: integer('count').notNull(),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    lastQuantity: real('last_quantity'),
    lastUnit: text('last_unit'),
    lastVariant: text('last_variant'),
    lastCount: integer('last_count'),
    lastNote: text('last_note'),
    /** JSON array of recently used variants, most recent first (K2 custom chips). */
    variants: text('variants'),
    /** Icon picked by the household; overrides the catalogue matcher. */
    icon: text('icon'),
    /** When the optional LLM was asked for a category — never ask twice. */
    categoryAskedAt: integer('category_asked_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.nameNormalized] })],
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
    /** Comma list of fixed shopping flags (Angebot, Dringend, …). */
    flags: text('flags'),
    note: text('note'),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    /** JSON object of per-field last-write times (epoch ms) for sync LWW. */
    fieldTimes: text('field_times'),
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
  /** Pack count: 2 × 500 g keeps both numbers visible while shopping. */
  count: integer('count'),
  origin: text('origin', { enum: ['manual', 'recipe'] }).notNull(),
  addedById: text('added_by_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  /** Last portion.set per-portion clock; null = never edited (createdAt rules). */
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

/** Instance-wide runtime settings (#73); env-pinned keys never get rows. */
export const instanceSettings = sqliteTable('instance_settings', {
  key: text('key').primaryKey(),
  /** JSON-encoded value; the registry knows each key's type. */
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/** Processed sync operation ids: replaying a queued operation is a no-op. */
export const appliedOperations = sqliteTable('applied_operations', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  appliedAt: integer('applied_at', { mode: 'timestamp_ms' }).notNull(),
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

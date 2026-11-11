import { sql } from 'drizzle-orm';
import { boolean, pgTable, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// No database-side defaults: values are set in code so that insert behaviour
// stays identical across dialects (see schema/types.ts).

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull(),
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

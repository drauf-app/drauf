import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import type { DatabaseConfig } from '../config.js';
import * as pgSchema from './schema/pg.js';
import * as sqliteSchema from './schema/sqlite.js';

export interface PostgresDatabase {
  dialect: 'postgres';
  db: NodePgDatabase<typeof pgSchema>;
  schema: typeof pgSchema;
  close(): Promise<void>;
}

export interface SqliteDatabase {
  dialect: 'sqlite';
  db: BetterSQLite3Database<typeof sqliteSchema>;
  schema: typeof sqliteSchema;
  close(): Promise<void>;
}

export type Database = PostgresDatabase | SqliteDatabase;

export function connectDatabase(config: DatabaseConfig): Database {
  if (config.dialect === 'postgres') {
    const pool = new pg.Pool({ connectionString: config.url });
    return {
      dialect: 'postgres',
      db: drizzlePg(pool, { schema: pgSchema }),
      schema: pgSchema,
      close: () => pool.end(),
    };
  }

  if (config.file !== ':memory:') {
    mkdirSync(dirname(config.file), { recursive: true });
  }
  const client = new BetterSqlite3(config.file);
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  return {
    dialect: 'sqlite',
    db: drizzleSqlite(client, { schema: sqliteSchema }),
    schema: sqliteSchema,
    close: () => {
      client.close();
      return Promise.resolve();
    },
  };
}

// Resolves to <package root>/drizzle/<dialect> from both src/ (dev) and dist/ (build).
function migrationsFolder(dialect: 'postgres' | 'sqlite'): string {
  return fileURLToPath(new URL(`../../drizzle/${dialect}`, import.meta.url));
}

export async function runMigrations(database: Database): Promise<void> {
  if (database.dialect === 'postgres') {
    await migratePg(database.db, { migrationsFolder: migrationsFolder('postgres') });
  } else {
    migrateSqlite(database.db, { migrationsFolder: migrationsFolder('sqlite') });
  }
}

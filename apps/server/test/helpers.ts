import type { FastifyInstance } from 'fastify';
import { type BuildAppOptions, buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { connectDatabase, type Database, runMigrations } from '../src/db/index.js';
import { seedDefaultHousehold } from '../src/db/seed.js';

export const TEST_AUTH_SECRET = 'test-secret-0123456789abcdef-0123456789abcdef';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    database: { dialect: 'sqlite', file: ':memory:' },
    authSecret: TEST_AUTH_SECRET,
    localLoginEnabled: true,
    publicUrl: undefined,
    oidc: undefined,
    disabledProviders: [],
    webDir: './test-no-web-dist',
    categorize: undefined,
    version: 'dev',
    commit: undefined,
    updateCheck: undefined,
    ...overrides,
  };
}

export interface TestApp {
  app: FastifyInstance;
  database: Database;
  config: Config;
  close(): Promise<void>;
}

export async function createTestApp(
  overrides: Partial<Config> = {},
  buildOptions: BuildAppOptions = {},
): Promise<TestApp> {
  const config = testConfig(overrides);
  const database = connectDatabase(config.database);
  await runMigrations(database);
  await seedDefaultHousehold(database);
  const app = await buildApp(config, database, buildOptions);
  return {
    app,
    database,
    config,
    close: async () => {
      await app.close();
      await database.close();
    },
  };
}

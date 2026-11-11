import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { TEST_AUTH_SECRET } from './helpers.js';

const BASE_ENV = { AUTH_SECRET: TEST_AUTH_SECRET };

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({ ...BASE_ENV })).toEqual({
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      database: { dialect: 'sqlite', file: 'data/drauf.db' },
      authSecret: TEST_AUTH_SECRET,
      localLoginEnabled: true,
    });
  });

  it('reads values from the environment', () => {
    const config = loadConfig({
      ...BASE_ENV,
      HOST: '::',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      AUTH_LOCAL_ENABLED: 'false',
    });
    expect(config).toMatchObject({
      host: '::',
      port: 8080,
      logLevel: 'debug',
      localLoginEnabled: false,
    });
  });

  it('requires AUTH_SECRET', () => {
    expect(() => loadConfig({})).toThrow();
  });

  it('rejects a short AUTH_SECRET', () => {
    expect(() => loadConfig({ AUTH_SECRET: 'too-short' })).toThrow();
  });

  it('places the default SQLite file inside DATA_DIR', () => {
    const config = loadConfig({ ...BASE_ENV, DATA_DIR: '/data' });
    expect(config.database).toEqual({ dialect: 'sqlite', file: '/data/drauf.db' });
  });

  it('selects PostgreSQL for postgres:// URLs', () => {
    const url = 'postgres://drauf:secret@db:5432/drauf';
    expect(loadConfig({ ...BASE_ENV, DATABASE_URL: url }).database).toEqual({
      dialect: 'postgres',
      url,
    });
  });

  it('selects SQLite for sqlite:// URLs', () => {
    expect(loadConfig({ ...BASE_ENV, DATABASE_URL: 'sqlite:///data/drauf.db' }).database).toEqual({
      dialect: 'sqlite',
      file: '/data/drauf.db',
    });
  });

  it('rejects unknown database URL schemes', () => {
    expect(() => loadConfig({ ...BASE_ENV, DATABASE_URL: 'mysql://db/drauf' })).toThrow();
  });
});

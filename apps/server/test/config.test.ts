import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      database: { dialect: 'sqlite', file: 'data/drauf.db' },
    });
  });

  it('reads values from the environment', () => {
    const config = loadConfig({ HOST: '::', PORT: '8080', LOG_LEVEL: 'debug' });
    expect(config).toMatchObject({ host: '::', port: 8080, logLevel: 'debug' });
  });

  it('places the default SQLite file inside DATA_DIR', () => {
    const config = loadConfig({ DATA_DIR: '/data' });
    expect(config.database).toEqual({ dialect: 'sqlite', file: '/data/drauf.db' });
  });

  it('selects PostgreSQL for postgres:// URLs', () => {
    const url = 'postgres://drauf:secret@db:5432/drauf';
    expect(loadConfig({ DATABASE_URL: url }).database).toEqual({ dialect: 'postgres', url });
  });

  it('selects SQLite for sqlite:// URLs', () => {
    expect(loadConfig({ DATABASE_URL: 'sqlite:///data/drauf.db' }).database).toEqual({
      dialect: 'sqlite',
      file: '/data/drauf.db',
    });
  });

  it('rejects unknown database URL schemes', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://db/drauf' })).toThrow();
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow();
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});

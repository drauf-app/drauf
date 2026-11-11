import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({ host: '0.0.0.0', port: 3000, logLevel: 'info' });
  });

  it('reads values from the environment', () => {
    const config = loadConfig({ HOST: '::', PORT: '8080', LOG_LEVEL: 'debug' });
    expect(config).toEqual({ host: '::', port: 8080, logLevel: 'debug' });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: 'not-a-port' })).toThrow();
  });

  it('rejects an unknown log level', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow();
  });
});

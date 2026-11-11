import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';

const testConfig: Config = { host: '127.0.0.1', port: 0, logLevel: 'silent' };

describe('GET /healthz', () => {
  it('responds with status ok', async () => {
    const app = buildApp(testConfig);
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await app.close();
  });
});

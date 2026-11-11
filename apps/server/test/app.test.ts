import { describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

describe('GET /healthz', () => {
  it('responds with status ok', async () => {
    const ctx = await createTestApp();
    const response = await ctx.app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });

    await ctx.close();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens.js';
import { createUser } from '../src/db/repositories.js';
import { DEFAULT_HOUSEHOLD_ID } from '../src/db/seed.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, TEST_AUTH_SECRET, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('household routes', () => {
  let ctx: TestApp;

  beforeEach(async () => {
    ctx = await createTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('returns the household with its members', async () => {
    await createLocalUser(ctx.database, {
      username: 'kathrin',
      password: PASSWORD,
      displayName: 'Kathrin',
      isAdmin: false,
    });
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'kathrin', password: PASSWORD },
    });
    const { accessToken } = login.json() as { accessToken: string };

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/households/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      id: string;
      members: Array<{ username: string; displayName: string }>;
    };
    expect(body.id).toBe(DEFAULT_HOUSEHOLD_ID);
    expect(body.members).toEqual([
      { userId: expect.any(String), username: 'kathrin', displayName: 'Kathrin' },
    ]);
  });

  it('hides the household from non-members', async () => {
    // Created directly, so the user never joined the default household.
    const outsider = await createUser(ctx.database, { username: 'drift', displayName: 'Drift' });
    const token = await signAccessToken(TEST_AUTH_SECRET, {
      userId: outsider.id,
      isAdmin: false,
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/households/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(404);
  });

  it('requires authentication', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/households/me' });
    expect(response.statusCode).toBe(401);
  });

  describe('staples', () => {
    let headers: { authorization: string };

    beforeEach(async () => {
      await createLocalUser(ctx.database, {
        username: 'kathrin',
        password: PASSWORD,
        displayName: 'Kathrin',
        isAdmin: false,
      });
      const login = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'kathrin', password: PASSWORD },
      });
      headers = {
        authorization: `Bearer ${(login.json() as { accessToken: string }).accessToken}`,
      };
    });

    it('starts with the defaults and saves a custom list', async () => {
      const initial = await ctx.app.inject({
        method: 'GET',
        url: '/api/households/staples',
        headers,
      });
      expect(initial.statusCode).toBe(200);
      const defaults = initial.json() as { staples: string[]; custom: boolean };
      expect(defaults.custom).toBe(false);
      expect(defaults.staples).toContain('Salz');

      const put = await ctx.app.inject({
        method: 'PUT',
        url: '/api/households/staples',
        headers,
        payload: { staples: ['Brühwürfel', '  Olivenöl ', 'brühwürfel'] },
      });
      expect(put.statusCode).toBe(200);
      // Trimmed and deduped case-insensitively, first casing wins.
      expect(put.json()).toEqual({ staples: ['Brühwürfel', 'Olivenöl'], custom: true });

      const after = await ctx.app.inject({
        method: 'GET',
        url: '/api/households/staples',
        headers,
      });
      expect(after.json()).toEqual({ staples: ['Brühwürfel', 'Olivenöl'], custom: true });
    });

    it('allows an empty custom list and resets to the defaults', async () => {
      await ctx.app.inject({
        method: 'PUT',
        url: '/api/households/staples',
        headers,
        payload: { staples: [] },
      });
      const empty = await ctx.app.inject({
        method: 'GET',
        url: '/api/households/staples',
        headers,
      });
      expect(empty.json()).toEqual({ staples: [], custom: true });

      const reset = await ctx.app.inject({
        method: 'DELETE',
        url: '/api/households/staples',
        headers,
      });
      expect(reset.statusCode).toBe(200);
      const body = reset.json() as { staples: string[]; custom: boolean };
      expect(body.custom).toBe(false);
      expect(body.staples).toContain('Pfeffer');
    });

    it('rejects staples requests from non-members', async () => {
      const outsider = await createUser(ctx.database, { username: 'drift2', displayName: 'D' });
      const token = await signAccessToken(TEST_AUTH_SECRET, {
        userId: outsider.id,
        isAdmin: false,
      });
      const response = await ctx.app.inject({
        method: 'PUT',
        url: '/api/households/staples',
        headers: { authorization: `Bearer ${token}` },
        payload: { staples: ['Salz'] },
      });
      expect(response.statusCode).toBe(404);
    });
  });
});

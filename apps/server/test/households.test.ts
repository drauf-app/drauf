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
      { userId: expect.any(String), username: 'kathrin', displayName: 'Kathrin', avatarUrl: null },
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

  describe('export', () => {
    it('returns one versioned document with the household data and no secrets', async () => {
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
      const headers = {
        authorization: `Bearer ${(login.json() as { accessToken: string }).accessToken}`,
      };

      // A little of everything: a list with a quantified entry, and a store.
      const list = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/lists',
          headers,
          payload: { name: 'Wocheneinkauf' },
        })
      ).json() as { id: string };
      await ctx.app.inject({
        method: 'POST',
        url: `/api/lists/${list.id}/entries`,
        headers,
        payload: { name: 'Milch', quantity: 1, unit: 'l' },
      });
      await ctx.app.inject({
        method: 'POST',
        url: '/api/stores',
        headers,
        payload: { name: 'Biomarkt' },
      });

      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/households/me/export',
        headers,
      });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-disposition']).toContain('drauf-export-');

      const body = response.json() as {
        version: number;
        household: { id: string; staples: string[] };
        users: Array<{ username: string }>;
        stores: Array<{ name: string; categoryOrder: string[] }>;
        categories: unknown[];
        mealSlots: unknown[];
        catalogUsage: Array<{ nameNormalized: string }>;
        lists: Array<{
          name: string;
          members: string[];
          entries: Array<{ name: string; portions: Array<{ quantity: number | null }> }>;
        }>;
      };
      expect(body.version).toBe(1);
      expect(body.household.id).toBe(DEFAULT_HOUSEHOLD_ID);
      expect(body.household.staples).toContain('Salz');
      expect(body.users).toEqual([
        expect.objectContaining({ username: 'kathrin', displayName: 'Kathrin' }),
      ]);
      expect(body.categories.length).toBeGreaterThan(0);
      expect(body.mealSlots.length).toBeGreaterThan(0);
      expect(body.stores).toEqual([expect.objectContaining({ name: 'Biomarkt' })]);
      expect(body.catalogUsage).toEqual([expect.objectContaining({ nameNormalized: 'milch' })]);
      const exported = body.lists.find((item) => item.name === 'Wocheneinkauf');
      expect(exported?.members.length).toBe(1);
      expect(exported?.entries[0]).toMatchObject({ name: 'Milch' });
      expect(exported?.entries[0]?.portions[0]).toMatchObject({ quantity: 1 });

      // Nothing secret leaves the server: no hashes, tokens or credentials.
      const raw = response.body;
      for (const needle of ['passwordHash', 'tokenHash', 'secret', 'password']) {
        expect(raw).not.toContain(needle);
      }
    });

    it('is hidden from non-members', async () => {
      const outsider = await createUser(ctx.database, { username: 'drift3', displayName: 'D' });
      const token = await signAccessToken(TEST_AUTH_SECRET, {
        userId: outsider.id,
        isAdmin: false,
      });
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/households/me/export',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(404);
    });
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

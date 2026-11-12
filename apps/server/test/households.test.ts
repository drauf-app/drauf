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
});

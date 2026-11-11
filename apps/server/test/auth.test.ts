import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FAILED_LOGINS } from '../src/auth/service.js';
import { signAccessToken } from '../src/auth/tokens.js';
import { listHouseholdMembers } from '../src/db/repositories.js';
import { DEFAULT_HOUSEHOLD_ID } from '../src/db/seed.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, TEST_AUTH_SECRET, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('auth and user routes', () => {
  let ctx: TestApp;
  let adminId: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    const result = await createLocalUser(ctx.database, {
      username: 'admin',
      password: PASSWORD,
      displayName: 'Admin',
      isAdmin: true,
    });
    if (!result.ok) throw new Error('fixture admin not created');
    adminId = result.user.id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function loginAs(username: string, password: string) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password },
    });
  }

  async function adminTokens() {
    const response = await loginAs('admin', PASSWORD);
    expect(response.statusCode).toBe(200);
    return response.json() as { accessToken: string; refreshToken: string };
  }

  it('logs in with valid credentials and returns the public user', async () => {
    const response = await loginAs('admin', PASSWORD);
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toBeTypeOf('string');
    expect(body.refreshToken).toBeTypeOf('string');
    expect(body.user).toMatchObject({ username: 'admin', isAdmin: true });
    expect(body.user.passwordHash).toBeUndefined();
  });

  it('rejects wrong passwords and unknown users alike', async () => {
    for (const [username, password] of [
      ['admin', 'wrong-password-x'],
      ['nobody', PASSWORD],
    ] as const) {
      const response = await loginAs(username, password);
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: 'invalid_credentials' });
    }
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 1; i < MAX_FAILED_LOGINS; i += 1) {
      expect((await loginAs('admin', 'wrong-password-x')).statusCode).toBe(401);
    }
    const locking = await loginAs('admin', 'wrong-password-x');
    expect(locking.statusCode).toBe(403);
    expect(locking.json()).toEqual({ error: 'account_locked' });

    // Even the correct password is rejected while locked.
    const lockedOut = await loginAs('admin', PASSWORD);
    expect(lockedOut.statusCode).toBe(403);
    expect(lockedOut.json()).toEqual({ error: 'account_locked' });
  });

  it('resets the failure counter after a successful login', async () => {
    for (let i = 1; i < MAX_FAILED_LOGINS; i += 1) {
      await loginAs('admin', 'wrong-password-x');
    }
    expect((await loginAs('admin', PASSWORD)).statusCode).toBe(200);
    // Counter was reset: more failures are needed again before the lock.
    expect((await loginAs('admin', 'wrong-password-x')).statusCode).toBe(401);
  });

  it('rotates refresh tokens', async () => {
    const { refreshToken } = await adminTokens();

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(first.statusCode).toBe(200);
    const rotated = first.json() as { refreshToken: string };
    expect(rotated.refreshToken).not.toBe(refreshToken);

    // The used token is revoked.
    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(replay.statusCode).toBe(401);

    // The rotated token works.
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: rotated.refreshToken },
    });
    expect(second.statusCode).toBe(200);
  });

  it('revokes the refresh token on logout', async () => {
    const { refreshToken } = await adminTokens();
    const logout = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(afterLogout.statusCode).toBe(401);
  });

  it('serves /me for authenticated requests only', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);

    const { accessToken } = await adminTokens();
    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ id: adminId, username: 'admin' });
  });

  it('rejects expired access tokens', async () => {
    const expired = await signAccessToken(
      TEST_AUTH_SECRET,
      { userId: adminId, isAdmin: true },
      -60,
    );
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${expired}` },
    });
    expect(response.statusCode).toBe(401);
  });

  it('refuses local login when disabled', async () => {
    const disabled = await createTestApp({ localLoginEnabled: false });
    try {
      await createLocalUser(disabled.database, {
        username: 'admin',
        password: PASSWORD,
        displayName: 'Admin',
        isAdmin: true,
      });
      const response = await disabled.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'admin', password: PASSWORD },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'local_login_disabled' });
    } finally {
      await disabled.close();
    }
  });

  it('rate limits login attempts per client', async () => {
    let limited = false;
    for (let i = 0; i < 11; i += 1) {
      const response = await loginAs(`ghost-${i}`, 'irrelevant-pass');
      if (response.statusCode === 429) {
        limited = true;
        break;
      }
    }
    expect(limited).toBe(true);
  });

  describe('user management', () => {
    it('requires an admin', async () => {
      const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/users' });
      expect(anonymous.statusCode).toBe(401);

      await createLocalUser(ctx.database, {
        username: 'kathrin',
        password: PASSWORD,
        displayName: 'Kathrin',
        isAdmin: false,
      });
      const login = await loginAs('kathrin', PASSWORD);
      const { accessToken } = login.json() as { accessToken: string };
      const forbidden = await ctx.app.inject({
        method: 'GET',
        url: '/api/users',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(forbidden.statusCode).toBe(403);
    });

    it('creates users that join the default household', async () => {
      const { accessToken } = await adminTokens();
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/users',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: { username: 'kathrin', password: PASSWORD, displayName: 'Kathrin' },
      });
      expect(created.statusCode).toBe(201);
      const user = created.json() as { id: string; isAdmin: boolean };
      expect(user.isAdmin).toBe(false);

      const members = await listHouseholdMembers(ctx.database, DEFAULT_HOUSEHOLD_ID);
      expect(members.map((m) => m.userId)).toContain(user.id);

      expect((await loginAs('kathrin', PASSWORD)).statusCode).toBe(200);
    });

    it('rejects taken usernames, bad usernames and short passwords', async () => {
      const { accessToken } = await adminTokens();
      const post = (payload: object) =>
        ctx.app.inject({
          method: 'POST',
          url: '/api/users',
          headers: { authorization: `Bearer ${accessToken}` },
          payload,
        });

      expect((await post({ username: 'admin', password: PASSWORD })).statusCode).toBe(409);
      expect((await post({ username: 'Bad Name!', password: PASSWORD })).statusCode).toBe(400);
      expect((await post({ username: 'kathrin', password: 'short' })).statusCode).toBe(400);
    });

    it('lists users for admins', async () => {
      const { accessToken } = await adminTokens();
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/users',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(response.statusCode).toBe(200);
      const users = response.json() as Array<{ username: string }>;
      expect(users.map((u) => u.username)).toEqual(['admin']);
    });
  });
});

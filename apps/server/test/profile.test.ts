import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createUser, getUserById } from '../src/db/repositories.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('profile routes (#98)', () => {
  let ctx: TestApp;
  let userId: string;
  let accessToken: string;

  beforeEach(async () => {
    ctx = await createTestApp();
    const result = await createLocalUser(ctx.database, {
      username: 'resi',
      password: PASSWORD,
      displayName: 'Resi',
      isAdmin: false,
    });
    if (!result.ok) throw new Error('fixture user not created');
    userId = result.user.id;
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'resi', password: PASSWORD },
    });
    accessToken = (login.json() as { accessToken: string }).accessToken;
  });

  afterEach(async () => {
    await ctx.close();
  });

  function session() {
    return { authorization: `Bearer ${accessToken}` };
  }

  it('reports avatarUrl and hasPassword on /me', async () => {
    const me = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers: session() });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ avatarUrl: null, hasPassword: true });
  });

  it('updates the display name, trimmed, and rejects blank ones', async () => {
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: session(),
      payload: { displayName: '  Resi B.  ' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().displayName).toBe('Resi B.');
    expect((await getUserById(ctx.database, userId))?.displayName).toBe('Resi B.');

    const blank = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: session(),
      payload: { displayName: '   ' },
    });
    expect(blank.statusCode).toBe(400);
    expect(blank.json().error).toBe('invalid_display_name');

    const anon = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { displayName: 'x' },
    });
    expect(anon.statusCode).toBe(401);
  });

  it('changes the password only with the current one and a long-enough new one', async () => {
    const wrong = await ctx.app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      headers: session(),
      payload: { currentPassword: 'not-the-password', newPassword: 'brand-new-password' },
    });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error).toBe('invalid_password');

    const short = await ctx.app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      headers: session(),
      payload: { currentPassword: PASSWORD, newPassword: 'short' },
    });
    expect(short.statusCode).toBe(400);
    expect(short.json().error).toBe('password_too_short');

    const ok = await ctx.app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      headers: session(),
      payload: { currentPassword: PASSWORD, newPassword: 'brand-new-password' },
    });
    expect(ok.statusCode).toBe(204);

    const oldLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'resi', password: PASSWORD },
    });
    expect(oldLogin.statusCode).toBe(401);
    const newLogin = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'resi', password: 'brand-new-password' },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it('refuses password changes for OIDC-only accounts', async () => {
    const oidcUser = await createUser(ctx.database, {
      username: 'oidc-only',
      displayName: 'OIDC Only',
      passwordHash: null,
    });
    const token = await import('../src/auth/tokens.js').then((m) =>
      m.signAccessToken(ctx.config.authSecret, { userId: oidcUser.id, isAdmin: false }),
    );
    const response = await ctx.app.inject({
      method: 'PUT',
      url: '/api/auth/password',
      headers: { authorization: `Bearer ${token}` },
      payload: { currentPassword: 'x', newPassword: 'brand-new-password' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('no_local_password');
  });
});

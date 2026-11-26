import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OidcConfig } from '../src/config.js';
import type { PublicUser } from '../src/users/service.js';
import { type FakeIdp, startFakeIdp } from './fake-idp.js';
import { createTestApp, type TestApp } from './helpers.js';

const PUBLIC_URL = 'http://drauf.test';

function oidcConfig(idp: FakeIdp): OidcConfig {
  return {
    issuer: idp.issuer,
    clientId: idp.clientId,
    clientSecret: undefined,
    scopes: 'openid profile',
    groupsClaim: 'groups',
    adminGroup: undefined,
    appRedirects: ['drauf://auth'],
  };
}

describe('avatars from the IdP (#98)', () => {
  let idp: FakeIdp;
  let ctx: TestApp;
  let avatarsDir: string;

  beforeAll(async () => {
    idp = await startFakeIdp();
  });

  afterAll(async () => {
    await idp.close();
  });

  beforeEach(async () => {
    avatarsDir = await mkdtemp(join(tmpdir(), 'drauf-avatars-'));
    idp.setPicture(Buffer.from('fake-png-bytes'), 'image/png');
    ctx = await createTestApp({ publicUrl: PUBLIC_URL, oidc: oidcConfig(idp), avatarsDir });
  });

  afterEach(async () => {
    await ctx.close();
    await rm(avatarsDir, { recursive: true, force: true });
  });

  /** Full OIDC round-trip; returns the signed-in user and an access token. */
  async function loginViaOidc(
    claims: Record<string, unknown>,
  ): Promise<{ user: PublicUser & { avatarUrl: string | null }; accessToken: string }> {
    const login = await ctx.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/login?redirect=${encodeURIComponent('/')}`,
    });
    expect(login.statusCode).toBe(302);
    const authUrl = new URL(login.headers.location as string);
    const state = authUrl.searchParams.get('state') as string;
    const nonce = authUrl.searchParams.get('nonce') as string;
    const code = idp.createCode({ ...claims, nonce });
    const callback = await ctx.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/callback?code=${code}&state=${state}`,
    });
    expect(callback.statusCode).toBe(302);
    const loginCode = new URL(callback.headers.location as string, PUBLIC_URL).searchParams.get(
      'login_code',
    );
    const exchange = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/oidc/exchange',
      payload: { code: loginCode },
    });
    expect(exchange.statusCode).toBe(200);
    const body = exchange.json();
    return { user: body.user, accessToken: body.accessToken };
  }

  const SUB = { sub: 'avatar-sub', name: 'Resi' };

  it('caches the picture claim at login and serves it hardened', async () => {
    const { user } = await loginViaOidc({ ...SUB, picture: `${idp.issuer}/picture` });
    expect(user.avatarUrl).toMatch(/^\/avatars\/[A-Za-z0-9_-]{22}\.png$/);

    const image = await ctx.app.inject({ method: 'GET', url: user.avatarUrl as string });
    expect(image.statusCode).toBe(200);
    expect(image.headers['content-type']).toBe('image/png');
    expect(image.headers['cache-control']).toContain('immutable');
    expect(image.headers['content-security-policy']).toContain('sandbox');
    expect(image.headers['x-content-type-options']).toBe('nosniff');
    expect(image.rawPayload.equals(Buffer.from('fake-png-bytes'))).toBe(true);
  });

  it('keeps the key while the image is unchanged and rotates it on change', async () => {
    const first = await loginViaOidc({ ...SUB, picture: `${idp.issuer}/picture` });
    const second = await loginViaOidc({ ...SUB, picture: `${idp.issuer}/picture` });
    expect(second.user.avatarUrl).toBe(first.user.avatarUrl);

    idp.setPicture(Buffer.from('different-webp-bytes'), 'image/webp');
    const third = await loginViaOidc({ ...SUB, picture: `${idp.issuer}/picture` });
    expect(third.user.avatarUrl).not.toBe(first.user.avatarUrl);
    expect(third.user.avatarUrl).toMatch(/\.webp$/);

    // The old URL is gone (key rotated), the new one serves, no file leaks.
    const stale = await ctx.app.inject({ method: 'GET', url: first.user.avatarUrl as string });
    expect(stale.statusCode).toBe(404);
    const fresh = await ctx.app.inject({ method: 'GET', url: third.user.avatarUrl as string });
    expect(fresh.statusCode).toBe(200);
    expect(await readdir(avatarsDir)).toHaveLength(1);
  });

  it('clears the avatar when the IdP stops sending a picture', async () => {
    await loginViaOidc({ ...SUB, picture: `${idp.issuer}/picture` });
    const { user } = await loginViaOidc(SUB);
    expect(user.avatarUrl).toBeNull();
    expect(await readdir(avatarsDir)).toHaveLength(0);
  });

  it('never breaks the login over a bad avatar', async () => {
    // Unsupported content type.
    idp.setPicture(Buffer.from('<svg/>'), 'image/svg+xml');
    const svg = await loginViaOidc({ ...SUB, picture: `${idp.issuer}/picture` });
    expect(svg.user.avatarUrl).toBeNull();

    // Oversized body.
    idp.setPicture(Buffer.alloc(1024 * 1024 + 1, 1), 'image/png');
    const big = await loginViaOidc({ ...SUB, picture: `${idp.issuer}/picture` });
    expect(big.user.avatarUrl).toBeNull();

    // Unreachable picture URL on a third-party host (SSRF-guarded path).
    const dead = await loginViaOidc({ ...SUB, picture: 'http://127.0.0.2:1/x.png' });
    expect(dead.user.avatarUrl).toBeNull();
  });

  it('serves 404 for unknown and malformed keys', async () => {
    for (const key of ['missing-key.png', '..%2F..%2Fsecret.png', 'AAAAAAAAAAAAAAAAAAAAAA.gif']) {
      const response = await ctx.app.inject({ method: 'GET', url: `/avatars/${key}` });
      expect(response.statusCode, key).toBe(404);
    }
  });

  it('exposes avatar URLs on household members', async () => {
    const { user, accessToken } = await loginViaOidc({ ...SUB, picture: `${idp.issuer}/picture` });
    const household = await ctx.app.inject({
      method: 'GET',
      url: '/api/households/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(household.statusCode).toBe(200);
    const member = household
      .json()
      .members.find((entry: { userId: string }) => entry.userId === user.id);
    expect(member.avatarUrl).toBe(user.avatarUrl);
  });
});

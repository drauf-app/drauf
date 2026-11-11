import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OidcConfig } from '../src/config.js';
import { listHouseholdMembers } from '../src/db/repositories.js';
import { DEFAULT_HOUSEHOLD_ID } from '../src/db/seed.js';
import { createLocalUser } from '../src/users/service.js';
import { type FakeIdp, startFakeIdp } from './fake-idp.js';
import { createTestApp, type TestApp } from './helpers.js';

const PUBLIC_URL = 'http://drauf.test';

function oidcConfig(idp: FakeIdp, overrides: Partial<OidcConfig> = {}): OidcConfig {
  return {
    issuer: idp.issuer,
    clientId: idp.clientId,
    clientSecret: undefined,
    scopes: 'openid profile',
    groupsClaim: 'groups',
    adminGroup: undefined,
    appRedirects: ['drauf://auth'],
    ...overrides,
  };
}

describe('OIDC login', () => {
  let idp: FakeIdp;
  let ctx: TestApp;

  beforeAll(async () => {
    idp = await startFakeIdp();
  });

  afterAll(async () => {
    await idp.close();
  });

  beforeEach(async () => {
    ctx = await createTestApp({ publicUrl: PUBLIC_URL, oidc: oidcConfig(idp) });
  });

  afterEach(async () => {
    await ctx.close();
  });

  /** Runs the full round-trip and returns the callback response. */
  async function runFlow(claims: Record<string, unknown>, redirect = '/') {
    const login = await ctx.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/login?redirect=${encodeURIComponent(redirect)}`,
    });
    expect(login.statusCode).toBe(302);
    const authUrl = new URL(login.headers.location as string);
    expect(authUrl.href.startsWith(idp.issuer)).toBe(true);
    expect(authUrl.searchParams.get('code_challenge_method')).toBe('S256');
    const state = authUrl.searchParams.get('state') as string;
    const nonce = authUrl.searchParams.get('nonce') as string;
    const code = idp.createCode({ ...claims, nonce });
    return ctx.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/callback?code=${code}&state=${state}`,
    });
  }

  async function exchange(callbackLocation: string) {
    const loginCode = new URL(callbackLocation, PUBLIC_URL).searchParams.get('login_code');
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/oidc/exchange',
      payload: { code: loginCode },
    });
    return response;
  }

  it('reports available providers', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(response.json()).toEqual({ localLogin: true, oidc: true });
  });

  it('creates an account on first login and signs the user in', async () => {
    const callback = await runFlow({
      sub: 'sub-1',
      preferred_username: 'Kathrin',
      name: 'Kathrin B',
    });
    expect(callback.statusCode).toBe(302);
    const location = callback.headers.location as string;
    expect(location.startsWith('/?login_code=')).toBe(true);

    const exchanged = await exchange(location);
    expect(exchanged.statusCode).toBe(200);
    const body = exchanged.json();
    expect(body.user).toMatchObject({
      username: 'kathrin',
      displayName: 'Kathrin B',
      isAdmin: false,
    });
    expect(body.accessToken).toBeTypeOf('string');

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    expect(me.statusCode).toBe(200);

    const members = await listHouseholdMembers(ctx.database, DEFAULT_HOUSEHOLD_ID);
    expect(members.map((m) => m.userId)).toContain(body.user.id);
  });

  it('matches returning users by subject, not by name', async () => {
    const first = await exchange(
      (await runFlow({ sub: 'sub-1', preferred_username: 'kathrin' })).headers.location as string,
    );
    const again = await exchange(
      (await runFlow({ sub: 'sub-1', preferred_username: 'renamed' })).headers.location as string,
    );
    const other = await exchange(
      (await runFlow({ sub: 'sub-2', preferred_username: 'kathrin' })).headers.location as string,
    );

    expect(again.json().user.id).toBe(first.json().user.id);
    expect(other.json().user.id).not.toBe(first.json().user.id);
    // Same preferred_username, different subject: unique username is derived.
    expect(other.json().user.username).toBe('kathrin-2');
  });

  it('avoids colliding with existing local usernames', async () => {
    await createLocalUser(ctx.database, {
      username: 'kathrin',
      password: 'local-password-1',
      displayName: 'Local Kathrin',
      isAdmin: false,
    });
    const exchanged = await exchange(
      (await runFlow({ sub: 'sub-9', preferred_username: 'kathrin' })).headers.location as string,
    );
    expect(exchanged.json().user.username).toBe('kathrin-2');
  });

  it('redirects to allowlisted app schemes and rejects foreign redirects', async () => {
    const callback = await runFlow({ sub: 'sub-1' }, 'drauf://auth/callback');
    expect(
      (callback.headers.location as string).startsWith('drauf://auth/callback?login_code='),
    ).toBe(true);

    const rejected = await ctx.app.inject({
      method: 'GET',
      url: `/api/auth/oidc/login?redirect=${encodeURIComponent('https://evil.example/phish')}`,
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toEqual({ error: 'invalid_redirect' });
  });

  it('rejects unknown state and replayed login codes', async () => {
    const noState = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/oidc/callback?code=whatever&state=unknown',
    });
    expect(noState.statusCode).toBe(400);
    expect(noState.json()).toEqual({ error: 'invalid_state' });

    const location = (await runFlow({ sub: 'sub-1' })).headers.location as string;
    expect((await exchange(location)).statusCode).toBe(200);
    const replay = await exchange(location);
    expect(replay.statusCode).toBe(401);
    expect(replay.json()).toEqual({ error: 'invalid_login_code' });
  });

  describe('admin group sync', () => {
    beforeEach(async () => {
      await ctx.close();
      ctx = await createTestApp({
        publicUrl: PUBLIC_URL,
        oidc: oidcConfig(idp, { adminGroup: 'drauf-admin' }),
      });
    });

    it('grants and revokes admin based on the groups claim', async () => {
      const promoted = await exchange(
        (
          await runFlow({
            sub: 'sub-1',
            preferred_username: 'kathrin',
            groups: ['family', 'drauf-admin'],
          })
        ).headers.location as string,
      );
      expect(promoted.json().user.isAdmin).toBe(true);

      const demoted = await exchange(
        (
          await runFlow({
            sub: 'sub-1',
            preferred_username: 'kathrin',
            groups: ['family'],
          })
        ).headers.location as string,
      );
      expect(demoted.json().user.isAdmin).toBe(false);
      expect(demoted.json().user.id).toBe(promoted.json().user.id);
    });
  });
});

describe('OIDC edge cases', () => {
  it('is disabled without configuration', async () => {
    const ctx = await createTestApp();
    try {
      const login = await ctx.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
      expect(login.statusCode).toBe(404);
      const providers = await ctx.app.inject({ method: 'GET', url: '/api/auth/providers' });
      expect(providers.json()).toEqual({ localLogin: true, oidc: false });
    } finally {
      await ctx.close();
    }
  });

  it('starts and answers 503 when the IdP is unreachable', async () => {
    const ctx = await createTestApp({
      publicUrl: PUBLIC_URL,
      oidc: {
        issuer: 'http://127.0.0.1:1',
        clientId: 'drauf-test',
        clientSecret: undefined,
        scopes: 'openid profile',
        groupsClaim: 'groups',
        adminGroup: undefined,
        appRedirects: [],
      },
    });
    try {
      // The app built and serves requests although discovery cannot succeed.
      expect((await ctx.app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
      const login = await ctx.app.inject({ method: 'GET', url: '/api/auth/oidc/login' });
      expect(login.statusCode).toBe(503);
      expect(login.json()).toEqual({ error: 'oidc_unavailable' });
    } finally {
      await ctx.close();
    }
  });
});

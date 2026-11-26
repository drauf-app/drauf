import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { API_TOKEN_PREFIX } from '../src/auth/api-tokens.js';
import { listApiTokensByUser } from '../src/db/repositories.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('API tokens (#97)', () => {
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

  async function createToken(scopes: string[], name = 'Home Assistant'): Promise<string> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/tokens',
      headers: session(),
      payload: { name, scopes },
    });
    expect(response.statusCode).toBe(201);
    return (response.json() as { token: string }).token;
  }

  describe('management routes', () => {
    it('creates a token, reveals it once and lists it without secrets', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/tokens',
        headers: session(),
        payload: { name: '  Home Assistant  ', scopes: ['plan:read', 'plan:read'] },
      });
      expect(response.statusCode).toBe(201);
      const created = response.json();
      expect(created.token).toMatch(/^drauf_[A-Za-z0-9_-]{43}$/);
      expect(created.name).toBe('Home Assistant');
      expect(created.scopes).toEqual(['plan:read']);
      expect(created.lastUsedAt).toBeNull();

      const list = await ctx.app.inject({
        method: 'GET',
        url: '/api/auth/tokens',
        headers: session(),
      });
      expect(list.statusCode).toBe(200);
      const rows = list.json();
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(created.id);
      expect(rows[0].token).toBeUndefined();
      expect(rows[0].tokenHash).toBeUndefined();
      // The database holds only the hash, never the plaintext.
      const stored = await listApiTokensByUser(ctx.database, userId);
      expect(stored[0]?.tokenHash).not.toContain(created.token);
      expect(stored[0]?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects unknown scopes, empty names and unauthenticated calls', async () => {
      const badScope = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/tokens',
        headers: session(),
        payload: { name: 'x', scopes: ['admin:write'] },
      });
      expect(badScope.statusCode).toBe(400);
      expect(badScope.json().error).toBe('invalid_scope');

      const blankName = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/tokens',
        headers: session(),
        payload: { name: '   ', scopes: ['plan:read'] },
      });
      expect(blankName.statusCode).toBe(400);

      const anon = await ctx.app.inject({ method: 'GET', url: '/api/auth/tokens' });
      expect(anon.statusCode).toBe(401);
    });

    it('revokes own tokens and leaves other users’ tokens alone', async () => {
      const token = await createToken(['plan:read']);
      const [row] = await listApiTokensByUser(ctx.database, userId);
      if (row === undefined) throw new Error('token row missing');

      const other = await createLocalUser(ctx.database, {
        username: 'other',
        password: PASSWORD,
        displayName: 'Other',
        isAdmin: false,
      });
      if (!other.ok) throw new Error('fixture user not created');
      const otherLogin = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'other', password: PASSWORD },
      });
      const otherAccess = (otherLogin.json() as { accessToken: string }).accessToken;
      const foreign = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/auth/tokens/${row.id}`,
        headers: { authorization: `Bearer ${otherAccess}` },
      });
      expect(foreign.statusCode).toBe(404);

      const own = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/auth/tokens/${row.id}`,
        headers: session(),
      });
      expect(own.statusCode).toBe(204);

      // The revoked token stops working immediately.
      const use = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/slots',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(use.statusCode).toBe(401);
    });
  });

  describe('scope enforcement', () => {
    it('grants exactly the scoped area and verb, nothing else', async () => {
      const token = await createToken(['plan:read']);
      const bearer = { authorization: `Bearer ${token}` };

      const read = await ctx.app.inject({ method: 'GET', url: '/api/plan/slots', headers: bearer });
      expect(read.statusCode).toBe(200);

      const write = await ctx.app.inject({
        method: 'POST',
        url: '/api/plan/entries',
        headers: bearer,
        payload: { date: '2026-11-26', text: 'Lasagne' },
      });
      expect(write.statusCode).toBe(403);
      expect(write.json().error).toBe('insufficient_scope');

      const otherArea = await ctx.app.inject({ method: 'GET', url: '/api/lists', headers: bearer });
      expect(otherArea.statusCode).toBe(403);
    });

    it('lets a write-scoped token write and a catalog token read suggestions', async () => {
      const planWrite = await createToken(['plan:write']);
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/plan/entries',
        headers: { authorization: `Bearer ${planWrite}` },
        payload: { date: '2026-11-26', text: 'Lasagne' },
      });
      expect(created.statusCode).toBe(201);

      const catalog = await createToken(['catalog:read']);
      const suggest = await ctx.app.inject({
        method: 'GET',
        url: '/api/catalog/suggest?q=nud',
        headers: { authorization: `Bearer ${catalog}` },
      });
      expect(suggest.statusCode).toBe(200);
    });

    it('refuses tokens everywhere outside the scoped areas', async () => {
      const token = await createToken(['plan:read', 'plan:write', 'lists:read', 'lists:write']);
      const bearer = { authorization: `Bearer ${token}` };
      const urls = [
        '/api/users',
        '/api/households/me',
        // The export must never be token-readable, whatever scopes are granted.
        '/api/households/me/export',
        '/api/auth/me',
        '/api/auth/tokens',
      ];
      for (const url of urls) {
        const response = await ctx.app.inject({ method: 'GET', url, headers: bearer });
        expect(response.statusCode, url).toBe(403);
        expect(response.json().error, url).toBe('insufficient_scope');
      }
      // Especially: a token can never mint further tokens.
      const mint = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/tokens',
        headers: bearer,
        payload: { name: 'escalation', scopes: ['plan:read'] },
      });
      expect(mint.statusCode).toBe(403);
    });

    it('rejects unknown tokens with 401 and rate-limits brute force', async () => {
      for (let attempt = 0; attempt < 11; attempt += 1) {
        const response = await ctx.app.inject({
          method: 'GET',
          url: '/api/plan/slots',
          headers: { authorization: `Bearer ${API_TOKEN_PREFIX}guess-${attempt}` },
        });
        expect(response.statusCode).toBe(401);
      }
      const limited = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/slots',
        headers: { authorization: `Bearer ${API_TOKEN_PREFIX}guess-final` },
      });
      expect(limited.statusCode).toBe(429);
    });

    it('records coarse last-use on successful token auth', async () => {
      const token = await createToken(['plan:read']);
      const bearer = { authorization: `Bearer ${token}` };
      await ctx.app.inject({ method: 'GET', url: '/api/plan/slots', headers: bearer });
      const [row] = await listApiTokensByUser(ctx.database, userId);
      expect(row?.lastUsedAt).toBeInstanceOf(Date);
      // A second call inside the hourly window keeps the stored value.
      const first = row?.lastUsedAt?.getTime();
      await ctx.app.inject({ method: 'GET', url: '/api/plan/slots', headers: bearer });
      const [again] = await listApiTokensByUser(ctx.database, userId);
      expect(again?.lastUsedAt?.getTime()).toBe(first);
    });

    it('keeps session logins unscoped (full access) on scoped routes', async () => {
      const response = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/slots',
        headers: session(),
      });
      expect(response.statusCode).toBe(200);
    });
  });
});

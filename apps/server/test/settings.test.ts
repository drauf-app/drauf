import type { RecipeProvider } from '@drauf/providers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalUser } from '../src/users/service.js';
import { isNewer, type UpdateChecker } from '../src/version/update-check.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

const fakeProvider: RecipeProvider = {
  id: 'fake',
  matches(input) {
    return input.includes('fake.example') ? 'https://fake.example/r/1' : null;
  },
  async fetch() {
    return { title: 'Suppe', imageUrl: null, servings: 2, ingredients: ['Salz'] };
  },
};

interface ResolvedSetting {
  key: string;
  type: string;
  default: unknown;
  envLock?: unknown;
  stored?: unknown;
  effective: unknown;
}

describe('isNewer', () => {
  it('orders releases and never nags dev builds', () => {
    expect(isNewer('v0.1.4', '0.1.3')).toBe(true);
    expect(isNewer('0.2.0', '0.10.0')).toBe(false);
    expect(isNewer('1.0.0', '0.9.9')).toBe(true);
    expect(isNewer('0.1.3', '0.1.3')).toBe(false);
    expect(isNewer('0.2.0', 'dev')).toBe(false);
    expect(isNewer('0.2.0', 'main@abc123')).toBe(false);
  });
});

describe('admin settings (#73)', () => {
  let ctx: TestApp;
  let admin: { authorization: string };
  let member: { authorization: string };

  async function login(username: string, isAdmin: boolean): Promise<{ authorization: string }> {
    await createLocalUser(ctx.database, {
      username,
      password: PASSWORD,
      displayName: username,
      isAdmin,
    });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: PASSWORD },
    });
    return {
      authorization: `Bearer ${(response.json() as { accessToken: string }).accessToken}`,
    };
  }

  beforeEach(async () => {
    ctx = await createTestApp({}, { providers: [fakeProvider] });
    admin = await login('admin', true);
    member = await login('member', false);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('is admin-only', async () => {
    const unauthenticated = await ctx.app.inject({ method: 'GET', url: '/api/admin/settings' });
    expect(unauthenticated.statusCode).toBe(401);
    const forbidden = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: member,
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('lists provider toggles and the unconfigured LLM switch', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: admin,
    });
    expect(response.statusCode).toBe(200);
    const { settings } = response.json() as { settings: ResolvedSetting[] };
    const provider = settings.find((s) => s.key === 'import.provider.fake');
    expect(provider).toMatchObject({ type: 'boolean', default: true, effective: true });
    // No CATEGORIZE_LLM in tests: the switch is locked off.
    const categorize = settings.find((s) => s.key === 'categorize.enabled');
    expect(categorize).toMatchObject({ envLock: false, effective: false });
  });

  it('toggles a provider off at runtime and back on', async () => {
    const list = await ctx.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers: admin,
      payload: { name: 'Weekly shop' },
    });
    expect(list.statusCode).toBe(201);

    async function preview(): Promise<number> {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/import/preview',
        headers: admin,
        payload: { input: 'https://fake.example/r/1' },
      });
      return response.statusCode;
    }

    expect(await preview()).toBe(200);

    const off = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: admin,
      payload: { key: 'import.provider.fake', value: false },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ stored: false, effective: false });
    expect(await preview()).toBe(422);

    await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: admin,
      payload: { key: 'import.provider.fake', value: true },
    });
    expect(await preview()).toBe(200);
  });

  it('rejects unknown, locked and mistyped settings', async () => {
    const unknown = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: admin,
      payload: { key: 'nope.nope', value: true },
    });
    expect(unknown.statusCode).toBe(404);

    // Locked: the unconfigured LLM switch is pinned off.
    const locked = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: admin,
      payload: { key: 'categorize.enabled', value: true },
    });
    expect(locked.statusCode).toBe(400);
    expect(locked.json()).toEqual({ error: 'locked_setting' });

    const mistyped = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: admin,
      payload: { key: 'import.provider.fake', value: 'yes' },
    });
    expect(mistyped.statusCode).toBe(400);
    expect(mistyped.json()).toEqual({ error: 'invalid_value' });
  });

  it('switches the icon pack and rejects unknown packs (#83)', async () => {
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: admin,
    });
    const pack = (list.json() as { settings: ResolvedSetting[] }).settings.find(
      (s) => s.key === 'icons.pack',
    );
    expect(pack).toMatchObject({
      type: 'string',
      default: 'openmoji',
      effective: 'openmoji',
      values: ['openmoji', 'fluent'],
    });

    const switched = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: admin,
      payload: { key: 'icons.pack', value: 'fluent' },
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json()).toMatchObject({ effective: 'fluent' });

    const unknownPack = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: admin,
      payload: { key: 'icons.pack', value: 'comic-sans' },
    });
    expect(unknownPack.statusCode).toBe(400);
    expect(unknownPack.json()).toEqual({ error: 'invalid_value' });
  });

  it('switches the LLM guessing off at runtime', async () => {
    const calls: string[] = [];
    const withLlm = await createTestApp(
      {
        categorize: {
          provider: 'anthropic',
          apiKey: 'k',
          model: 'test-model',
          modelFromEnv: false,
        },
      },
      {
        providers: [fakeProvider],
        categorizer: {
          guess: async (name) => {
            calls.push(name);
            return 'none';
          },
        },
      },
    );
    try {
      await createLocalUser(withLlm.database, {
        username: 'root',
        password: PASSWORD,
        displayName: 'root',
        isAdmin: true,
      });
      const auth = await withLlm.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'root', password: PASSWORD },
      });
      const headers = {
        authorization: `Bearer ${(auth.json() as { accessToken: string }).accessToken}`,
      };
      const list = await withLlm.app.inject({
        method: 'POST',
        url: '/api/lists',
        headers,
        payload: { name: 'L' },
      });
      const listId = (list.json() as { id: string }).id;

      const off = await withLlm.app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        headers,
        payload: { key: 'categorize.enabled', value: false },
      });
      expect(off.statusCode).toBe(200);

      const added = await withLlm.app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/entries`,
        headers,
        payload: { name: 'Zaubertrank' },
      });
      const view = added.json() as { categorizing?: boolean };
      expect(view.categorizing).toBeUndefined();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls).toHaveLength(0);
    } finally {
      await withLlm.close();
    }
  });

  it('serves the version publicly and gates the update check (#74)', async () => {
    const checks: number[] = [];
    const checker: UpdateChecker = {
      cached: () => undefined,
      check: async (maxAgeMs = 0) => {
        checks.push(maxAgeMs);
        return {
          currentVersion: 'dev',
          latestVersion: '9.9.9',
          latestUrl: 'https://github.com/drauf-app/drauf/releases/tag/v9.9.9',
          updateAvailable: false,
          checkedAt: new Date().toISOString(),
        };
      },
    };
    const app = await createTestApp({}, { updateChecker: checker });
    try {
      const version = await app.app.inject({ method: 'GET', url: '/api/version' });
      expect(version.statusCode).toBe(200);
      expect(version.json()).toEqual({ version: 'dev', commit: null });

      await createLocalUser(app.database, {
        username: 'root',
        password: PASSWORD,
        displayName: 'root',
        isAdmin: true,
      });
      const auth = await app.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'root', password: PASSWORD },
      });
      const headers = {
        authorization: `Bearer ${(auth.json() as { accessToken: string }).accessToken}`,
      };

      // Disabled (the default): GET never phones home.
      const idle = await app.app.inject({
        method: 'GET',
        url: '/api/admin/settings/update-check',
        headers,
      });
      expect(idle.json()).toEqual({ enabled: false, result: null });
      expect(checks).toHaveLength(0);

      // The manual button always may.
      const manual = await app.app.inject({
        method: 'POST',
        url: '/api/admin/settings/update-check',
        headers,
      });
      expect((manual.json() as { result: { latestVersion: string } }).result.latestVersion).toBe(
        '9.9.9',
      );
      expect(checks).toEqual([0]);

      // Enabled: GET refreshes with the daily max age.
      await app.app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        headers,
        payload: { key: 'updates.check', value: true },
      });
      await app.app.inject({
        method: 'GET',
        url: '/api/admin/settings/update-check',
        headers,
      });
      expect(checks).toHaveLength(2);
      expect(checks[1]).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it('locks env-disabled providers off', async () => {
    const locked = await createTestApp(
      { disabledProviders: ['fake'] },
      { providers: [fakeProvider] },
    );
    try {
      await createLocalUser(locked.database, {
        username: 'root',
        password: PASSWORD,
        displayName: 'root',
        isAdmin: true,
      });
      const auth = await locked.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'root', password: PASSWORD },
      });
      const headers = {
        authorization: `Bearer ${(auth.json() as { accessToken: string }).accessToken}`,
      };
      const response = await locked.app.inject({
        method: 'GET',
        url: '/api/admin/settings',
        headers,
      });
      const { settings } = response.json() as { settings: ResolvedSetting[] };
      expect(settings.find((s) => s.key === 'import.provider.fake')).toMatchObject({
        envLock: false,
        effective: false,
      });
      const put = await locked.app.inject({
        method: 'PUT',
        url: '/api/admin/settings',
        headers,
        payload: { key: 'import.provider.fake', value: true },
      });
      expect(put.statusCode).toBe(400);
      expect(put.json()).toEqual({ error: 'locked_setting' });
    } finally {
      await locked.close();
    }
  });
});

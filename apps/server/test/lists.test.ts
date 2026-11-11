import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('list routes', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let kathrin: { id: string; token: string };

  async function createAndLogin(username: string): Promise<{ id: string; token: string }> {
    const result = await createLocalUser(ctx.database, {
      username,
      password: PASSWORD,
      displayName: username,
      isAdmin: false,
    });
    if (!result.ok) throw new Error('fixture user not created');
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: PASSWORD },
    });
    return { id: result.user.id, token: (login.json() as { accessToken: string }).accessToken };
  }

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
  }

  async function createList(name = 'Weekly shop'): Promise<{ id: string; ownerId: string }> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers: as(christian),
      payload: { name, icon: 'cart', color: '#33AA55' },
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    christian = await createAndLogin('christian');
    kathrin = await createAndLogin('kathrin');
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('requires authentication', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/lists' })).statusCode).toBe(401);
  });

  it('creates a list that starts with all default-household members', async () => {
    const list = await createList();
    expect(list.ownerId).toBe(christian.id);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${list.id}`,
      headers: as(christian),
    });
    expect(detail.statusCode).toBe(200);
    const members = (detail.json() as { members: Array<{ userId: string; username: string }> })
      .members;
    expect(members.map((m) => m.userId).sort()).toEqual([christian.id, kathrin.id].sort());

    // Both household members see the list.
    for (const user of [christian, kathrin]) {
      const index = await ctx.app.inject({ method: 'GET', url: '/api/lists', headers: as(user) });
      expect((index.json() as Array<{ id: string }>).map((l) => l.id)).toContain(list.id);
    }
  });

  it('hides lists from removed members without leaking existence', async () => {
    const list = await createList();
    const removal = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/members/${kathrin.id}`,
      headers: as(christian),
    });
    expect(removal.statusCode).toBe(204);

    const index = await ctx.app.inject({ method: 'GET', url: '/api/lists', headers: as(kathrin) });
    expect((index.json() as Array<{ id: string }>).map((l) => l.id)).not.toContain(list.id);

    for (const [method, url, payload] of [
      ['GET', `/api/lists/${list.id}`, undefined],
      ['PATCH', `/api/lists/${list.id}`, { name: 'Hijacked' }],
      ['DELETE', `/api/lists/${list.id}`, undefined],
      ['PUT', `/api/lists/${list.id}/members/${kathrin.id}`, undefined],
    ] as const) {
      const response = await ctx.app.inject({
        method,
        url,
        headers: as(kathrin),
        ...(payload === undefined ? {} : { payload }),
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('lets any member rename and archive, but only the owner delete', async () => {
    const list = await createList();

    const renamed = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${list.id}`,
      headers: as(kathrin),
      payload: { name: 'Drugstore', archived: true },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({ name: 'Drugstore', archived: true });

    const forbidden = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}`,
      headers: as(kathrin),
    });
    expect(forbidden.statusCode).toBe(403);

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}`,
      headers: as(christian),
    });
    expect(deleted.statusCode).toBe(204);
    expect(
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/lists/${list.id}`,
          headers: as(christian),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('lets only the owner manage members and re-add removed ones', async () => {
    const list = await createList();

    const notOwner = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/members/${christian.id}`,
      headers: as(kathrin),
    });
    expect(notOwner.statusCode).toBe(403);

    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/members/${kathrin.id}`,
      headers: as(christian),
    });
    const readd = await ctx.app.inject({
      method: 'PUT',
      url: `/api/lists/${list.id}/members/${kathrin.id}`,
      headers: as(christian),
    });
    expect(readd.statusCode).toBe(204);

    const index = await ctx.app.inject({ method: 'GET', url: '/api/lists', headers: as(kathrin) });
    expect((index.json() as Array<{ id: string }>).map((l) => l.id)).toContain(list.id);
  });

  it('rejects foreign or unknown user ids in member payloads', async () => {
    const list = await createList();
    const response = await ctx.app.inject({
      method: 'PUT',
      url: `/api/lists/${list.id}/members/00000000-0000-7000-8000-00000000dead`,
      headers: as(christian),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_user' });
  });

  it('refuses to remove the owner from the list', async () => {
    const list = await createList();
    const response = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${list.id}/members/${christian.id}`,
      headers: as(christian),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'cannot_remove_owner' });
  });

  it('validates the payloads', async () => {
    for (const payload of [{ name: '' }, { name: 'ok', color: 'green' }, {}]) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/lists',
        headers: as(christian),
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    const list = await createList();
    const emptyPatch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${list.id}`,
      headers: as(christian),
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);
  });
});

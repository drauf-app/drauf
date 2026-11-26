import type { CatalogItem } from '@drauf/catalog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AdminCatalogItem } from '../src/routes/catalog-items.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

const fakeCatalog: CatalogItem[] = [
  {
    name: 'Nudeln',
    categoryKey: 'pasta-rice-canned',
    synonyms: [],
    icon: '🍝',
    sizes: [],
    varieties: [],
  },
];

describe('admin catalog item editor', () => {
  let ctx: TestApp;
  let admin: { id: string; token: string };
  let member: { id: string; token: string };
  let listId: string;

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
  }

  async function loginUser(username: string, isAdmin: boolean) {
    const result = await createLocalUser(ctx.database, {
      username,
      password: PASSWORD,
      displayName: username,
      isAdmin,
    });
    if (!result.ok) throw new Error('fixture user not created');
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username, password: PASSWORD },
    });
    return { id: result.user.id, token: (login.json() as { accessToken: string }).accessToken };
  }

  async function addItem(payload: object) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(admin),
      payload,
    });
    expect([200, 201]).toContain(response.statusCode);
  }

  async function listItems(query = ''): Promise<{ items: AdminCatalogItem[]; total: number }> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/catalog/items${query}`,
      headers: as(admin),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  beforeEach(async () => {
    ctx = await createTestApp({}, { catalog: fakeCatalog });
    admin = await loginUser('christian', true);
    member = await loginUser('kathrin', false);
    const list = await ctx.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers: as(admin),
      payload: { name: 'Weekly shop' },
    });
    listId = (list.json() as { id: string }).id;
    await addItem({ name: 'Nudeln' });
    await addItem({ name: 'Tomaten' });
    await addItem({ name: 'Tomaten' });
    await addItem({ name: 'Tomtaen' });
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('is admin- and session-only', async () => {
    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/catalog/items' });
    expect(anonymous.statusCode).toBe(401);

    const asMember = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/items',
      headers: as(member),
    });
    expect(asMember.statusCode).toBe(403);

    const minted = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/tokens',
      headers: as(admin),
      payload: { name: 'HA', scopes: ['catalog:read'] },
    });
    expect(minted.statusCode).toBe(201);
    const { token } = minted.json() as { token: string };
    const asToken = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/items',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(asToken.statusCode).toBe(403);
  });

  it('lists the learned rows with counts, custom flag, search and paging', async () => {
    const all = await listItems();
    expect(all.total).toBe(3);
    expect(all.items.map((item) => item.name)).toEqual(['Tomaten', 'Nudeln', 'Tomtaen']);
    const nudeln = all.items.find((item) => item.name === 'Nudeln');
    expect(nudeln).toMatchObject({ custom: false, icon: '🍝', count: 1 });
    expect(all.items.find((item) => item.name === 'Tomaten')).toMatchObject({
      custom: true,
      count: 2,
    });

    const custom = await listItems('?custom=true');
    expect(custom.items.map((item) => item.name)).toEqual(['Tomaten', 'Tomtaen']);

    const searched = await listItems('?q=Tomt');
    expect(searched.items.map((item) => item.name)).toEqual(['Tomtaen']);

    const paged = await listItems('?limit=1&offset=1');
    expect(paged.items.map((item) => item.name)).toEqual(['Nudeln']);
    expect(paged.total).toBe(3);
  });

  it('merges a rename into an existing row and drops the typo from suggestions', async () => {
    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/catalog/items/tomtaen',
      headers: as(admin),
      payload: { name: 'Tomaten' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: 'Tomaten',
      nameNormalized: 'tomaten',
      count: 3,
    });

    const all = await listItems();
    expect(all.total).toBe(2);

    const suggest = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/suggest?q=tomt',
      headers: as(admin),
    });
    expect(suggest.json()).toEqual([]);
  });

  it('edits category and icon with validation', async () => {
    const categories = (await (
      await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: as(admin) })
    ).json()) as Array<{ id: string; key: string | null }>;
    const produce = categories.find((category) => category.key === 'fruit-vegetables')?.id;
    expect(produce).toBeDefined();

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/catalog/items/tomaten',
      headers: as(admin),
      payload: { categoryId: produce, icon: 'openmoji:1F345' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ categoryId: produce, icon: 'openmoji:1F345' });

    const cleared = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/catalog/items/tomaten',
      headers: as(admin),
      payload: { categoryId: null, icon: '' },
    });
    expect(cleared.json()).toMatchObject({ categoryId: null, icon: null });

    const badCategory = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/catalog/items/tomaten',
      headers: as(admin),
      payload: { categoryId: 'nope' },
    });
    expect(badCategory.statusCode).toBe(400);
    expect(badCategory.json()).toEqual({ error: 'invalid_category' });

    const badIcon = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/catalog/items/tomaten',
      headers: as(admin),
      payload: { icon: 'custom:' },
    });
    expect(badIcon.statusCode).toBe(400);
    expect(badIcon.json()).toEqual({ error: 'invalid_icon' });

    const missing = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/catalog/items/unbekannt',
      headers: as(admin),
      payload: { categoryId: null },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('deletes a row, which removes it from suggestions but not from lists', async () => {
    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/catalog/items/tomtaen',
      headers: as(admin),
    });
    expect(deleted.statusCode).toBe(204);

    const again = await ctx.app.inject({
      method: 'DELETE',
      url: '/api/catalog/items/tomtaen',
      headers: as(admin),
    });
    expect(again.statusCode).toBe(404);

    const suggest = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/suggest?q=tomt',
      headers: as(admin),
    });
    expect(suggest.json()).toEqual([]);

    const entries = (await (
      await ctx.app.inject({
        method: 'GET',
        url: `/api/lists/${listId}/entries`,
        headers: as(admin),
      })
    ).json()) as Array<{ name: string }>;
    expect(entries.map((entry) => entry.name)).toContain('Tomtaen');
  });
});

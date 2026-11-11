import type { CatalogItem } from '@drauf/catalog';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Suggestion } from '../src/routes/catalog.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

const fakeCatalog: CatalogItem[] = [
  {
    name: 'Nudeln',
    categoryKey: 'pasta-rice-canned',
    synonyms: ['Pasta'],
    icon: '🍝',
    sizes: ['500 g', '1 kg'],
    varieties: ['Fusilli', 'Penne'],
  },
  {
    name: 'Nussnugatcreme',
    categoryKey: 'breakfast-sweets',
    synonyms: [],
    icon: '🍫',
    sizes: [],
    varieties: [],
  },
  {
    name: 'Milch',
    categoryKey: 'dairy-chilled',
    synonyms: [],
    icon: '🥛',
    sizes: ['1 l'],
    varieties: [],
  },
];

describe('catalog suggestions', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let listId: string;

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
  }

  async function addItem(payload: object) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
      payload,
    });
    expect([200, 201]).toContain(response.statusCode);
    return response.json() as { id: string };
  }

  async function suggest(q: string, limit?: number): Promise<Suggestion[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/catalog/suggest?q=${encodeURIComponent(q)}${limit === undefined ? '' : `&limit=${limit}`}`,
      headers: as(christian),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  beforeEach(async () => {
    ctx = await createTestApp({}, { catalog: fakeCatalog });
    const result = await createLocalUser(ctx.database, {
      username: 'christian',
      password: PASSWORD,
      displayName: 'Christian',
      isAdmin: false,
    });
    if (!result.ok) throw new Error('fixture user not created');
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'christian', password: PASSWORD },
    });
    christian = {
      id: result.user.id,
      token: (login.json() as { accessToken: string }).accessToken,
    };
    const list = await ctx.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers: as(christian),
      payload: { name: 'Weekly shop' },
    });
    listId = (list.json() as { id: string }).id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('requires authentication', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/catalog/suggest?q=nu' });
    expect(response.statusCode).toBe(401);
  });

  it('suggests catalogue items with chips and the household category id', async () => {
    const suggestions = await suggest('nud');
    expect(suggestions).toHaveLength(1);
    const [nudeln] = suggestions;
    expect(nudeln).toMatchObject({
      name: 'Nudeln',
      source: 'catalog',
      icon: '🍝',
      sizes: ['500 g', '1 kg'],
      varieties: ['Fusilli', 'Penne'],
    });
    // The category key resolves to this household's category row.
    const categories = (await (
      await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: as(christian) })
    ).json()) as Array<{ id: string; key: string | null }>;
    expect(nudeln?.categoryId).toBe(categories.find((c) => c.key === 'pasta-rice-canned')?.id);
  });

  it('matches synonyms', async () => {
    const suggestions = await suggest('pasta');
    expect(suggestions.map((s) => s.name)).toContain('Nudeln');
  });

  it('ranks household history first, enriched with catalogue chips (K4)', async () => {
    await addItem({ name: 'Nudeln', quantity: 500, unit: 'g', variant: 'Penne' });
    const suggestions = await suggest('nu');
    expect(suggestions.map((s) => `${s.source}:${s.name}`)).toEqual([
      'history:Nudeln',
      'catalog:Nussnugatcreme',
    ]);
    expect(suggestions[0]).toMatchObject({
      count: 1,
      lastQuantity: 500,
      lastUnit: 'g',
      lastVariant: 'Penne',
      icon: '🍝',
      varieties: ['Fusilli', 'Penne'],
    });
  });

  it('orders history by frequency', async () => {
    await addItem({ name: 'Nudeln' });
    const milk = await addItem({ name: 'Milch', quantity: 1, unit: 'l' });
    await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries/${milk.id}/check`,
      headers: as(christian),
    });
    await addItem({ name: 'Milch', quantity: 1, unit: 'l' });
    await addItem({ name: 'Nudeln' });
    await addItem({ name: 'Nudeln' });

    const byPrefix = await suggest('m');
    expect(byPrefix[0]?.name).toBe('Milch');
    expect(byPrefix[0]?.count).toBe(2);

    const n = await suggest('nudeln');
    expect(n[0]?.count).toBe(3);
  });

  it('learns items unknown to the catalogue, including a chosen category (K3)', async () => {
    const entry = await addItem({ name: 'Zimtschnecken' });
    let suggestions = await suggest('zimt');
    expect(suggestions).toEqual([
      expect.objectContaining({
        name: 'Zimtschnecken',
        source: 'history',
        categoryId: null,
        icon: null,
      }),
    ]);

    const categories = (await (
      await ctx.app.inject({ method: 'GET', url: '/api/categories', headers: as(christian) })
    ).json()) as Array<{ id: string; key: string | null }>;
    const bakery = categories.find((c) => c.key === 'bread-bakery')?.id as string;
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${entry.id}`,
      headers: as(christian),
      payload: { categoryId: bakery },
    });

    suggestions = await suggest('zimt');
    expect(suggestions[0]?.categoryId).toBe(bakery);
  });

  it('respects the limit', async () => {
    const suggestions = await suggest('n', 1);
    expect(suggestions).toHaveLength(1);
  });
});

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

describe('category guessing on add', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let listId: string;
  let categoryIdByKey: Map<string, string>;

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
  }

  async function addItem(payload: object): Promise<{ id: string; categoryId: string | null }> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
      payload,
    });
    expect([200, 201]).toContain(response.statusCode);
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
    const categories = await ctx.app.inject({
      method: 'GET',
      url: '/api/categories',
      headers: as(christian),
    });
    categoryIdByKey = new Map(
      (categories.json() as Array<{ id: string; key: string | null }>)
        .filter((category) => category.key !== null)
        .map((category) => [category.key as string, category.id]),
    );
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('assigns the catalogue category on an exact match', async () => {
    const entry = await addItem({ name: 'Milch' });
    expect(entry.categoryId).toBe(categoryIdByKey.get('dairy-chilled'));
  });

  it('resolves the catalogue icon for entry views', async () => {
    const created = (await addItem({ name: 'Milch' })) as { icon?: string | null };
    expect(created.icon).toBe('🥛');
    const compound = (await addItem({ name: 'Würznudeln' })) as { icon?: string | null };
    expect(compound.icon).toBe('🍝');
    const list = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
    });
    const views = list.json() as Array<{ name: string; icon: string | null }>;
    expect(views.find((view) => view.name === 'Milch')?.icon).toBe('🥛');
    expect(views.find((view) => view.name === 'Xyzzy')?.icon ?? null).toBeNull();
  });

  it('assigns the category of the compound head noun', async () => {
    // German compounds end with the head: Würznudeln are a kind of Nudeln.
    const entry = await addItem({ name: 'Würznudeln' });
    expect(entry.categoryId).toBe(categoryIdByKey.get('pasta-rice-canned'));
  });

  it('matches synonyms too', async () => {
    const entry = await addItem({ name: 'Pasta' });
    expect(entry.categoryId).toBe(categoryIdByKey.get('pasta-rice-canned'));
  });

  it('prefers the household’s learned category over the catalogue', async () => {
    const first = await addItem({ name: 'Milch' });
    const corrected = categoryIdByKey.get('other') as string;
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${first.id}`,
      headers: as(christian),
      payload: { categoryId: corrected },
    });
    expect(patch.statusCode).toBe(200);

    // A different variant forces a new entry instead of a merge.
    const again = await addItem({ name: 'Milch', variant: 'laktosefrei' });
    expect(again.categoryId).toBe(corrected);
  });

  it('leaves unknown items uncategorized', async () => {
    const entry = await addItem({ name: 'Xyzzy' });
    expect(entry.categoryId).toBeNull();
  });

  it('never overrides an explicitly chosen category', async () => {
    const chosen = categoryIdByKey.get('household') as string;
    const entry = await addItem({ name: 'Milch', variant: 'explizit', categoryId: chosen });
    expect(entry.categoryId).toBe(chosen);
  });
});

describe('recent variants in suggestions', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let listId: string;

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
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

  it('learns variants applied after the add and serves them most-recent-first', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
      payload: { name: 'Chips' },
    });
    const entry = created.json() as { id: string };

    // A custom chip applies a variant via PATCH; the household learns it.
    for (const variant of ['Lays', 'Paprika']) {
      const patched = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/lists/${listId}/entries/${entry.id}`,
        headers: as(christian),
        payload: { variant },
      });
      expect(patched.statusCode).toBe(200);
    }

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/suggest?q=chips',
      headers: as(christian),
    });
    const [suggestion] = response.json() as Array<{
      recentVariants: string[];
      lastVariant: string | null;
    }>;
    expect(suggestion?.recentVariants).toEqual(['Paprika', 'Lays']);
    expect(suggestion?.lastVariant).toBe('Paprika');
  });
});

describe('pack counts (2 × 500 g)', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let listId: string;

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
  }

  interface View {
    id: string;
    quantities: Array<{ unit: string | null; quantity: number; count?: number }>;
  }

  async function addItem(payload: object): Promise<View> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
      payload,
    });
    expect([200, 201]).toContain(response.statusCode);
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

  it('keeps both numbers for a single counted portion', async () => {
    const view = await addItem({ name: 'Hack', quantity: 500, unit: 'g', count: 2 });
    expect(view.quantities).toEqual([{ unit: 'g', quantity: 500, count: 2 }]);
  });

  it('sums count × quantity once portions merge', async () => {
    await addItem({ name: 'Hack', quantity: 500, unit: 'g', count: 2 });
    const merged = await addItem({ name: 'Hack', quantity: 300, unit: 'g' });
    expect(merged.quantities).toEqual([{ unit: 'g', quantity: 1300 }]);
  });

  it('renders a bare pack count as a plain number', async () => {
    const view = await addItem({ name: 'Brezeln', count: 3 });
    expect(view.quantities).toEqual([{ unit: null, quantity: 3 }]);
  });

  it('replaces and clears the count via PATCH', async () => {
    const created = await addItem({ name: 'Hack', quantity: 500, unit: 'g' });
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${created.id}`,
      headers: as(christian),
      payload: { quantity: 500, unit: 'g', count: 2 },
    });
    expect((patched.json() as View).quantities).toEqual([{ unit: 'g', quantity: 500, count: 2 }]);

    const cleared = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${created.id}`,
      headers: as(christian),
      payload: { quantity: 500, unit: 'g' },
    });
    expect((cleared.json() as View).quantities).toEqual([{ unit: 'g', quantity: 500 }]);
  });

  it('rejects invalid counts and remembers the last one for suggestions', async () => {
    const invalid = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
      payload: { name: 'Hack', count: 0 },
    });
    expect(invalid.statusCode).toBe(400);

    await addItem({ name: 'Hack', quantity: 500, unit: 'g', count: 2 });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/catalog/suggest?q=hack',
      headers: as(christian),
    });
    const [suggestion] = response.json() as Array<{ lastCount: number | null }>;
    expect(suggestion?.lastCount).toBe(2);
  });
});

describe('entry flags', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let listId: string;
  let entryId: string;

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
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
    const created = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
      payload: { name: 'Milch' },
    });
    entryId = (created.json() as { id: string }).id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function patchFlags(flags: string) {
    return ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${entryId}`,
      headers: as(christian),
      payload: { flags },
    });
  }

  it('sets, keeps and clears the fixed flags', async () => {
    const set = await patchFlags('Dringend, Angebot');
    expect(set.statusCode).toBe(200);
    expect((set.json() as { flags: string }).flags).toBe('Dringend, Angebot');

    const cleared = await patchFlags('');
    expect((cleared.json() as { flags: string | null }).flags).toBeNull();
  });

  it('rejects unknown flags', async () => {
    const response = await patchFlags('Dringend, Später');
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'invalid_flags' });
  });
});

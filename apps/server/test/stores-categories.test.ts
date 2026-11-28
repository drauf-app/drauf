import { BASE_CATEGORIES } from '@drauf/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Category } from '../src/db/schema/types.js';
import { seedDefaultHousehold } from '../src/db/seed.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('categories and stores', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };

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

  async function getCategories(): Promise<Category[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/categories',
      headers: as(christian),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    christian = await createAndLogin('christian');
  });

  afterEach(async () => {
    await ctx.close();
  });

  describe('categories', () => {
    it('seeds the base set once, in order', async () => {
      await seedDefaultHousehold(ctx.database); // second run must not duplicate
      const categories = await getCategories();
      expect(categories.map((c) => c.key)).toEqual(BASE_CATEGORIES.map((c) => c.key));
      expect(categories[0]).toMatchObject({ key: 'fruit-vegetables', name: 'Obst & Gemüse' });
    });

    it('creates custom categories at the end of the order', async () => {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/categories',
        headers: as(christian),
        payload: { name: 'Baumarkt' },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toMatchObject({ name: 'Baumarkt', key: null });

      const categories = await getCategories();
      expect(categories.at(-1)?.name).toBe('Baumarkt');
    });

    it('renames base categories but refuses to delete them', async () => {
      const [first] = await getCategories();
      const renamed = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/categories/${first?.id}`,
        headers: as(christian),
        payload: { name: 'Obst, Gemüse & Kräuter' },
      });
      expect(renamed.statusCode).toBe(200);
      expect((renamed.json() as Category).name).toBe('Obst, Gemüse & Kräuter');

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/categories/${first?.id}`,
        headers: as(christian),
      });
      expect(deleted.statusCode).toBe(400);
      expect(deleted.json()).toEqual({ error: 'base_category' });
    });

    it('resolves default icons, stores overrides and clears them (#71)', async () => {
      const categories = await getCategories();
      const fruit = categories.find((category) => category.key === 'fruit-vegetables');
      expect(fruit?.icon).toBe('🥕');

      const overridden = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/categories/${fruit?.id}`,
        headers: as(christian),
        payload: { icon: 'custom:gemuese' },
      });
      expect(overridden.statusCode).toBe(200);
      expect(overridden.json()).toMatchObject({ icon: 'custom:gemuese' });
      const listed = await getCategories();
      expect(listed.find((category) => category.key === 'fruit-vegetables')?.icon).toBe(
        'custom:gemuese',
      );

      // '' clears the override back to the base default.
      const cleared = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/categories/${fruit?.id}`,
        headers: as(christian),
        payload: { icon: '' },
      });
      expect(cleared.json()).toMatchObject({ icon: '🥕' });

      const invalid = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/categories/${fruit?.id}`,
        headers: as(christian),
        payload: { icon: 'custom:not a key' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ error: 'invalid_icon' });

      // Household-created categories start without an icon.
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/categories',
        headers: as(christian),
        payload: { name: 'Baumarkt' },
      });
      expect((created.json() as Category).icon).toBeNull();
    });

    it('deletes custom categories and clears them from entries', async () => {
      const custom = (await (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/categories',
          headers: as(christian),
          payload: { name: 'Baumarkt' },
        })
      ).json()) as Category;

      const list = (await (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/lists',
          headers: as(christian),
          payload: { name: 'Weekly shop' },
        })
      ).json()) as { id: string };
      const entry = (await (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/lists/${list.id}/entries`,
          headers: as(christian),
          payload: { name: 'Schrauben', categoryId: custom.id },
        })
      ).json()) as { id: string; categoryId: string };
      expect(entry.categoryId).toBe(custom.id);

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/categories/${custom.id}`,
        headers: as(christian),
      });
      expect(deleted.statusCode).toBe(204);

      const entries = (await (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/lists/${list.id}/entries`,
          headers: as(christian),
        })
      ).json()) as Array<{ categoryId: string | null }>;
      expect(entries[0]?.categoryId).toBeNull();
    });

    it('rejects foreign category ids on entries', async () => {
      const list = (await (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/lists',
          headers: as(christian),
          payload: { name: 'Weekly shop' },
        })
      ).json()) as { id: string };
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/api/lists/${list.id}/entries`,
        headers: as(christian),
        payload: { name: 'Milch', categoryId: '00000000-0000-7000-8000-00000000dead' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: 'invalid_category' });
    });

    it('adopts a category on merge only when the entry has none', async () => {
      const [first, second] = await getCategories();
      const list = (await (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/lists',
          headers: as(christian),
          payload: { name: 'Weekly shop' },
        })
      ).json()) as { id: string };
      const add = (payload: object) =>
        ctx.app.inject({
          method: 'POST',
          url: `/api/lists/${list.id}/entries`,
          headers: as(christian),
          payload,
        });

      // A name the catalogue cannot guess, so the first entry starts bare.
      await add({ name: 'Zaubertrank' });
      const merged = await add({ name: 'Zaubertrank', categoryId: first?.id });
      expect((merged.json() as { categoryId: string }).categoryId).toBe(first?.id);
      const again = await add({ name: 'Zaubertrank', categoryId: second?.id });
      expect((again.json() as { categoryId: string }).categoryId).toBe(first?.id);
    });
  });

  describe('stores', () => {
    async function createStore(name: string): Promise<{ id: string }> {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/stores',
        headers: as(christian),
        payload: { name },
      });
      expect(response.statusCode).toBe(201);
      return response.json();
    }

    it('creates, renames, lists and deletes stores', async () => {
      const store = await createStore('Alnatura');
      const renamed = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/stores/${store.id}`,
        headers: as(christian),
        payload: { name: 'Alnatura Mitte' },
      });
      expect((renamed.json() as { name: string }).name).toBe('Alnatura Mitte');

      const index = await ctx.app.inject({
        method: 'GET',
        url: '/api/stores',
        headers: as(christian),
      });
      expect(
        (index.json() as Array<{ name: string; categoryOrder: string[] }>).map((s) => s.name),
      ).toEqual(['Alnatura Mitte']);

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/stores/${store.id}`,
        headers: as(christian),
      });
      expect(deleted.statusCode).toBe(204);
    });

    it('stores a custom category order per store', async () => {
      const store = await createStore('Kaufland');
      const categories = await getCategories();
      const reversed = categories.map((c) => c.id).reverse();

      const ordered = await ctx.app.inject({
        method: 'PUT',
        url: `/api/stores/${store.id}/category-order`,
        headers: as(christian),
        payload: { categoryIds: reversed },
      });
      expect(ordered.statusCode).toBe(200);
      expect((ordered.json() as { categoryOrder: string[] }).categoryOrder).toEqual(reversed);

      const index = await ctx.app.inject({
        method: 'GET',
        url: '/api/stores',
        headers: as(christian),
      });
      expect((index.json() as Array<{ categoryOrder: string[] }>)[0]?.categoryOrder).toEqual(
        reversed,
      );
    });

    it('stores the categories a store does not carry (#115)', async () => {
      const store = await createStore('Drogeriemarkt');
      const categories = await getCategories();
      const frozen = categories.find((category) => category.key === 'frozen')?.id as string;
      const drinks = categories.find((category) => category.key === 'drinks')?.id as string;

      // Default: carries everything.
      const index = await ctx.app.inject({
        method: 'GET',
        url: '/api/stores',
        headers: as(christian),
      });
      expect(
        (index.json() as Array<{ excludedCategoryIds: string[] }>)[0]?.excludedCategoryIds,
      ).toEqual([]);

      const set = await ctx.app.inject({
        method: 'PUT',
        url: `/api/stores/${store.id}/excluded-categories`,
        headers: as(christian),
        payload: { categoryIds: [frozen, drinks] },
      });
      expect(set.statusCode).toBe(200);
      expect((set.json() as { excludedCategoryIds: string[] }).excludedCategoryIds).toEqual([
        frozen,
        drinks,
      ]);

      const after = await ctx.app.inject({
        method: 'GET',
        url: '/api/stores',
        headers: as(christian),
      });
      expect(
        (after.json() as Array<{ excludedCategoryIds: string[] }>)[0]?.excludedCategoryIds.sort(),
      ).toEqual([frozen, drinks].sort());

      // Clearing works, and unknown/duplicate ids are rejected like the order.
      const cleared = await ctx.app.inject({
        method: 'PUT',
        url: `/api/stores/${store.id}/excluded-categories`,
        headers: as(christian),
        payload: { categoryIds: [] },
      });
      expect((cleared.json() as { excludedCategoryIds: string[] }).excludedCategoryIds).toEqual([]);
      for (const categoryIds of [['00000000-0000-7000-8000-00000000dead'], [frozen, frozen]]) {
        const bad = await ctx.app.inject({
          method: 'PUT',
          url: `/api/stores/${store.id}/excluded-categories`,
          headers: as(christian),
          payload: { categoryIds },
        });
        expect(bad.statusCode).toBe(400);
        expect(bad.json()).toEqual({ error: 'invalid_categories' });
      }
    });

    it('drops exclusions with a deleted category (cascade, #115)', async () => {
      const store = await createStore('Biomarkt');
      const created = (await (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/categories',
          headers: as(christian),
          payload: { name: 'Tierbedarf' },
        })
      ).json()) as { id: string };

      await ctx.app.inject({
        method: 'PUT',
        url: `/api/stores/${store.id}/excluded-categories`,
        headers: as(christian),
        payload: { categoryIds: [created.id] },
      });
      const removed = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/categories/${created.id}`,
        headers: as(christian),
      });
      expect(removed.statusCode).toBe(204);

      const after = await ctx.app.inject({
        method: 'GET',
        url: '/api/stores',
        headers: as(christian),
      });
      expect(
        (after.json() as Array<{ excludedCategoryIds: string[] }>)[0]?.excludedCategoryIds,
      ).toEqual([]);
    });

    it('rejects unknown and duplicate category ids in the order', async () => {
      const store = await createStore('Rewe');
      const categories = await getCategories();
      const firstId = categories[0]?.id as string;

      for (const categoryIds of [['00000000-0000-7000-8000-00000000dead'], [firstId, firstId]]) {
        const response = await ctx.app.inject({
          method: 'PUT',
          url: `/api/stores/${store.id}/category-order`,
          headers: as(christian),
          payload: { categoryIds },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toEqual({ error: 'invalid_categories' });
      }
    });

    it('sets and clears the default store of a list (L7)', async () => {
      const store = await createStore('Kaufland');
      const list = (await (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/lists',
          headers: as(christian),
          payload: { name: 'Weekly shop' },
        })
      ).json()) as { id: string };

      const set = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/lists/${list.id}`,
        headers: as(christian),
        payload: { defaultStoreId: store.id },
      });
      expect((set.json() as { defaultStoreId: string }).defaultStoreId).toBe(store.id);

      const invalid = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/lists/${list.id}`,
        headers: as(christian),
        payload: { defaultStoreId: '00000000-0000-7000-8000-00000000dead' },
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({ error: 'invalid_store' });

      // Deleting the store clears the reference.
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/stores/${store.id}`,
        headers: as(christian),
      });
      const detail = await ctx.app.inject({
        method: 'GET',
        url: `/api/lists/${list.id}`,
        headers: as(christian),
      });
      expect((detail.json() as { defaultStoreId: string | null }).defaultStoreId).toBeNull();
    });
  });
});

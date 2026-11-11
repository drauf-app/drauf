import type { RecipeProvider } from '@drauf/providers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MealSlot } from '../src/db/schema/types.js';
import { FetchGuardError, fetchGuarded, isPrivateAddress } from '../src/import/fetch.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

const fakeProvider: RecipeProvider = {
  id: 'fake',
  matches(input) {
    return input.includes('fake.example') ? 'https://fake.example/r/1' : null;
  },
  async fetch() {
    return {
      title: 'Tomatensuppe',
      imageUrl: 'https://img.example/x.jpg',
      servings: 4,
      ingredients: ['500 g Tomaten', '1 Zwiebel', 'Salz', '2 EL Öl'],
    };
  },
};

describe('recipe import', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let listId: string;
  let lunch: MealSlot;

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
  }

  beforeEach(async () => {
    ctx = await createTestApp({}, { providers: [fakeProvider] });
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
    const slots = await ctx.app.inject({
      method: 'GET',
      url: '/api/plan/slots',
      headers: as(christian),
    });
    lunch = (slots.json() as MealSlot[])[0] as MealSlot;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('previews a shared text with parsed ingredients and staple marking', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: as(christian),
      payload: { input: 'Schau dir dieses Rezept an! https://fake.example/r/1 Guten Appetit' },
    });
    expect(response.statusCode).toBe(200);
    const preview = response.json();
    expect(preview).toMatchObject({
      provider: 'fake',
      title: 'Tomatensuppe',
      servings: 4,
    });
    expect(preview.ingredients).toEqual([
      { raw: '500 g Tomaten', name: 'Tomaten', quantity: 500, unit: 'g', isStaple: false },
      { raw: '1 Zwiebel', name: 'Zwiebel', quantity: 1, isStaple: false },
      { raw: 'Salz', name: 'Salz', isStaple: true },
      { raw: '2 EL Öl', name: 'Öl', quantity: 2, unit: 'EL', isStaple: true },
    ]);
  });

  it('answers 422 when no provider matches', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/import/preview',
      headers: as(christian),
      payload: { input: 'https://unknown.example/r/1' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({ error: 'no_provider' });
  });

  it('respects disabled providers', async () => {
    const disabled = await createTestApp(
      { disabledProviders: ['fake'] },
      { providers: [fakeProvider] },
    );
    try {
      await createLocalUser(disabled.database, {
        username: 'user',
        password: PASSWORD,
        displayName: 'User',
        isAdmin: false,
      });
      const login = await disabled.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { username: 'user', password: PASSWORD },
      });
      const token = (login.json() as { accessToken: string }).accessToken;
      const response = await disabled.app.inject({
        method: 'POST',
        url: '/api/import/preview',
        headers: { authorization: `Bearer ${token}` },
        payload: { input: 'https://fake.example/r/1' },
      });
      expect(response.statusCode).toBe(422);
    } finally {
      await disabled.close();
    }
  });

  it('applies selected ingredients to a list and links the recipe on the plan', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/import/apply',
      headers: as(christian),
      payload: {
        list: {
          id: listId,
          items: [
            { name: 'Tomaten', quantity: 500, unit: 'g' },
            { name: 'Zwiebel', quantity: 1 },
          ],
        },
        plan: {
          date: '2026-11-16',
          slotId: lunch.id,
          title: 'Tomatensuppe',
          link: 'https://fake.example/r/1',
          imageUrl: 'https://img.example/x.jpg',
        },
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.entries).toHaveLength(2);
    expect(body.planEntry).toMatchObject({
      date: '2026-11-16',
      text: 'Tomatensuppe',
      link: 'https://fake.example/r/1',
      imageUrl: 'https://img.example/x.jpg',
    });

    // Origin of every imported portion is 'recipe' and merging applies (L4).
    const entries = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
    });
    const tomatoes = (
      entries.json() as Array<{ name: string; portions: Array<{ origin: string }> }>
    ).find((e) => e.name === 'Tomaten');
    expect(tomatoes?.portions.every((p) => p.origin === 'recipe')).toBe(true);
  });

  it('validates everything before writing anything', async () => {
    const occupied = await ctx.app.inject({
      method: 'POST',
      url: '/api/plan/entries',
      headers: as(christian),
      payload: { date: '2026-11-16', slotId: lunch.id, text: 'Belegt' },
    });
    expect(occupied.statusCode).toBe(201);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/import/apply',
      headers: as(christian),
      payload: {
        list: { id: listId, items: [{ name: 'Tomaten' }] },
        plan: { date: '2026-11-16', slotId: lunch.id, link: 'https://fake.example/r/1' },
      },
    });
    expect(response.statusCode).toBe(409);

    // The occupied plan slot prevented the list items from being written.
    const entries = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
    });
    expect(entries.json()).toEqual([]);
  });

  it('rejects foreign lists, categories, slots and bad links', async () => {
    const bogus = '00000000-0000-7000-8000-00000000dead';
    const cases: Array<[object, number]> = [
      [{ list: { id: bogus, items: [{ name: 'X' }] } }, 404],
      [{ list: { id: listId, items: [{ name: 'X', categoryId: bogus }] } }, 400],
      [{ plan: { date: '2026-11-16', slotId: bogus, link: 'https://x.example/1' } }, 400],
      [{ plan: { date: '2026-11-16', slotId: lunch.id, link: 'ftp://x.example/1' } }, 400],
      [{}, 400],
    ];
    for (const [payload, status] of cases) {
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/api/import/apply',
        headers: as(christian),
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(status);
    }
  });
});

describe('SSRF guard', () => {
  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.16.0.1', true],
    ['172.32.0.1', false],
    ['192.168.1.1', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['0.0.0.0', true],
    ['224.0.0.1', true],
    ['::1', true],
    ['::ffff:127.0.0.1', true],
    ['fd12::1', true],
    ['fe80::1', true],
    ['93.184.216.34', false],
    ['2606:2800:220:1::1', false],
  ])('classifies %s as private=%s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });

  it('blocks literal private addresses and non-http URLs without fetching', async () => {
    for (const url of [
      'http://127.0.0.1/x',
      'http://[::1]/x',
      'http://169.254.169.254/latest/meta-data',
      'ftp://example.com/x',
      'not a url',
    ]) {
      const error = await fetchGuarded(url, {
        timeoutMs: 1000,
        maxBytes: 1024,
        accept: '*/*',
        allowedContentTypes: [''],
      }).catch((err: unknown) => err);
      expect(error, url).toBeInstanceOf(FetchGuardError);
    }
  });
});

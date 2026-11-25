import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MealSlot, PlanEntry } from '../src/db/schema/types.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('meal plan routes', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let kathrin: { id: string; token: string };
  let lunch: MealSlot;
  let dinner: MealSlot;

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

  async function getSlots(): Promise<MealSlot[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/plan/slots',
      headers: as(christian),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function addEntry(payload: object, user = christian) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/plan/entries',
      headers: as(user),
      payload,
    });
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    christian = await createAndLogin('christian');
    kathrin = await createAndLogin('kathrin');
    [lunch, dinner] = (await getSlots()) as [MealSlot, MealSlot];
  });

  afterEach(async () => {
    await ctx.close();
  });

  describe('slots', () => {
    it('seeds lunch and dinner for a fresh household', async () => {
      expect([lunch.name, dinner.name]).toEqual(['Mittagessen', 'Abendessen']);
    });

    it('creates, renames, reorders and deletes slots', async () => {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/api/plan/slots',
        headers: as(christian),
        payload: { name: 'Frühstück' },
      });
      expect(created.statusCode).toBe(201);
      const breakfast = created.json() as MealSlot;

      const moved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/plan/slots/${breakfast.id}`,
        headers: as(kathrin),
        payload: { sortOrder: 5, name: 'Morgens' },
      });
      expect(moved.statusCode).toBe(200);
      expect((await getSlots()).map((s) => s.name)).toEqual([
        'Morgens',
        'Mittagessen',
        'Abendessen',
      ]);

      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/plan/slots/${breakfast.id}`,
        headers: as(christian),
      });
      expect(deleted.statusCode).toBe(204);
      expect(await getSlots()).toHaveLength(2);
    });

    it('keeps entries when their label slot is deleted', async () => {
      await addEntry({ date: '2026-11-16', slotId: lunch.id, text: 'Pasta' });
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/plan/slots/${lunch.id}`,
        headers: as(christian),
      });
      const entries = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/entries?from=2026-11-16&to=2026-11-16',
        headers: as(christian),
      });
      // Slots are labels now, not containers: the label goes, the meal stays.
      expect(entries.json()).toMatchObject([{ text: 'Pasta', slotId: null }]);
    });
  });

  describe('entries', () => {
    it('plans free text or links with an optional cook', async () => {
      const text = await addEntry({
        date: '2026-11-16',
        slotId: lunch.id,
        text: 'Pasta',
        cookId: kathrin.id,
      });
      expect(text.statusCode).toBe(201);
      expect(text.json()).toMatchObject({ text: 'Pasta', link: null, cookId: kathrin.id });

      const link = await addEntry({
        date: '2026-11-16',
        slotId: dinner.id,
        link: 'https://example.com/recipes/42',
      });
      expect(link.statusCode).toBe(201);

      const week = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/entries?from=2026-11-16&to=2026-11-22',
        headers: as(kathrin),
      });
      expect((week.json() as PlanEntry[]).map((e) => e.slotId)).toEqual([lunch.id, dinner.id]);
    });

    it('rejects entries with neither text nor link, bad links and bad dates', async () => {
      for (const [payload, error] of [
        [{ date: '2026-11-16', slotId: lunch.id }, 'text_or_link_required'],
        [{ date: '2026-11-16', slotId: lunch.id, link: 'ftp://example.com' }, 'invalid_link'],
        [{ date: '2026-02-31', slotId: lunch.id, text: 'Pasta' }, 'invalid_date'],
      ] as const) {
        const response = await addEntry(payload);
        expect(response.statusCode, JSON.stringify(payload)).toBe(400);
        expect(response.json()).toEqual({ error });
      }
    });

    it('rejects foreign slot and cook ids (nested ids)', async () => {
      const bogus = '00000000-0000-7000-8000-00000000dead';
      const slot = await addEntry({ date: '2026-11-16', slotId: bogus, text: 'Pasta' });
      expect(slot.statusCode).toBe(400);
      expect(slot.json()).toEqual({ error: 'invalid_slot' });

      const cook = await addEntry({
        date: '2026-11-16',
        slotId: lunch.id,
        text: 'Pasta',
        cookId: bogus,
      });
      expect(cook.statusCode).toBe(400);
      expect(cook.json()).toEqual({ error: 'invalid_cook' });
    });

    it('holds any number of entries per day, labeled or not', async () => {
      await addEntry({ date: '2026-11-16', slotId: lunch.id, text: 'Pasta' });
      const second = await addEntry({ date: '2026-11-16', slotId: lunch.id, text: 'Curry' });
      expect(second.statusCode).toBe(201);
      // No label at all: just something for that day (e.g. a cake).
      const unlabeled = await addEntry({ date: '2026-11-16', text: 'Kuchen' });
      expect(unlabeled.statusCode).toBe(201);
      expect((unlabeled.json() as PlanEntry).slotId).toBeNull();

      const entries = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/entries?from=2026-11-16&to=2026-11-16',
        headers: as(christian),
      });
      expect(entries.json()).toHaveLength(3);
    });

    it('moves entries between days and relabels them (W6)', async () => {
      const entry = (await (
        await addEntry({ date: '2026-11-16', slotId: lunch.id, text: 'Pasta' })
      ).json()) as PlanEntry;
      await addEntry({ date: '2026-11-17', slotId: lunch.id, text: 'Curry' });

      // Days hold any number of entries now: moving next to Curry is fine.
      const moved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/plan/entries/${entry.id}`,
        headers: as(kathrin),
        payload: { date: '2026-11-17', slotId: dinner.id },
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({ date: '2026-11-17', slotId: dinner.id, text: 'Pasta' });

      // '' clears the label back to "none".
      const unlabeled = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/plan/entries/${entry.id}`,
        headers: as(christian),
        payload: { slotId: '' },
      });
      expect(unlabeled.statusCode).toBe(200);
      expect((unlabeled.json() as PlanEntry).slotId).toBeNull();
    });

    it('clears cook and swaps text for link, but never both to null', async () => {
      const entry = (await (
        await addEntry({
          date: '2026-11-16',
          slotId: lunch.id,
          text: 'Pasta',
          cookId: kathrin.id,
        })
      ).json()) as PlanEntry;

      const cleared = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/plan/entries/${entry.id}`,
        headers: as(christian),
        payload: { cookId: '', link: 'https://example.com/r/1', text: '' },
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({
        cookId: null,
        text: null,
        link: 'https://example.com/r/1',
      });

      const empty = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/plan/entries/${entry.id}`,
        headers: as(christian),
        payload: { link: '' },
      });
      expect(empty.statusCode).toBe(400);
      expect(empty.json()).toEqual({ error: 'text_or_link_required' });
    });

    it('remembers cooked recipes with last-cooked info (#88)', async () => {
      // Three past Lasagne entries in mixed spelling, one other meal, one
      // planned in the future (not cooked yet) and one link-only entry.
      await addEntry({ date: '2026-01-05', slotId: lunch.id, text: 'Lasagne' });
      await addEntry({
        date: '2026-02-10',
        slotId: dinner.id,
        text: '  lasagne ',
        link: 'https://example.com/r/lasagne',
      });
      await addEntry({ date: '2026-03-03', slotId: lunch.id, text: 'Lasagne' });
      await addEntry({ date: '2026-03-04', slotId: lunch.id, text: 'Kartoffelsuppe' });
      await addEntry({ date: '2099-01-01', slotId: lunch.id, text: 'Lasagne' });
      await addEntry({ date: '2026-03-05', slotId: lunch.id, link: 'https://example.com/r/x' });

      const all = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/recipes',
        headers: as(christian),
      });
      expect(all.statusCode).toBe(200);
      const suggestions = all.json() as Array<Record<string, unknown>>;
      // Newest first; the future entry and the title-less link don't count.
      expect(suggestions.map((s) => s.text)).toEqual(['Kartoffelsuppe', 'Lasagne']);
      expect(suggestions[1]).toMatchObject({
        text: 'Lasagne',
        timesCooked: 3,
        lastCookedAt: '2026-03-03',
        // The link sticks even though the newest entry has none.
        link: 'https://example.com/r/lasagne',
      });

      const filtered = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/recipes?q=lasa&limit=5',
        headers: as(christian),
      });
      expect((filtered.json() as Array<{ text: string }>).map((s) => s.text)).toEqual(['Lasagne']);

      const none = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/recipes?q=Pizza',
        headers: as(christian),
      });
      expect(none.json()).toEqual([]);
    });

    it('deletes entries and validates the query range', async () => {
      const entry = (await (
        await addEntry({ date: '2026-11-16', slotId: lunch.id, text: 'Pasta' })
      ).json()) as PlanEntry;
      const deleted = await ctx.app.inject({
        method: 'DELETE',
        url: `/api/plan/entries/${entry.id}`,
        headers: as(christian),
      });
      expect(deleted.statusCode).toBe(204);

      const inverted = await ctx.app.inject({
        method: 'GET',
        url: '/api/plan/entries?from=2026-11-20&to=2026-11-16',
        headers: as(christian),
      });
      expect(inverted.statusCode).toBe(400);
      expect(inverted.json()).toEqual({ error: 'invalid_range' });
    });

    it('requires authentication', async () => {
      expect((await ctx.app.inject({ method: 'GET', url: '/api/plan/slots' })).statusCode).toBe(
        401,
      );
    });
  });
});

describe('plan link preview (W4)', () => {
  const PASSWORD = 'correct-horse-battery';
  let ctx: TestApp;
  let token: string;
  let slotId: string;

  function fakeProvider(fetchImpl: () => Promise<never> | Promise<object>) {
    return {
      id: 'fake',
      matches: (input: string) => (input.includes('fake.example') ? input : null),
      fetch: fetchImpl as never,
    };
  }

  async function setup(provider: object): Promise<void> {
    ctx = await createTestApp(
      {},
      {
        providers: [provider as never],
        providerContext: { fetchText: async () => '' },
      },
    );
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
    token = (login.json() as { accessToken: string }).accessToken;
    const slots = await ctx.app.inject({
      method: 'GET',
      url: '/api/plan/slots',
      headers: { authorization: `Bearer ${token}` },
    });
    slotId = (slots.json() as Array<{ id: string }>)[0]?.id ?? '';
  }

  afterEach(async () => {
    await ctx.close();
  });

  async function createWithLink(link: string) {
    return ctx.app.inject({
      method: 'POST',
      url: '/api/plan/entries',
      headers: { authorization: `Bearer ${token}` },
      payload: { date: '2026-11-20', slotId, link },
    });
  }

  it('fills title and image from the provider when only a link is given', async () => {
    await setup(
      fakeProvider(async () => ({
        title: 'Tomatensuppe',
        imageUrl: 'https://img.example/suppe.jpg',
        servings: 4,
        ingredients: [],
      })),
    );
    const response = await createWithLink('https://fake.example/r/1');
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      text: 'Tomatensuppe',
      link: 'https://fake.example/r/1',
      imageUrl: 'https://img.example/suppe.jpg',
    });
  });

  it('keeps the bare link when the provider fails (fail open)', async () => {
    await setup(
      fakeProvider(async () => {
        throw new Error('scrape failed');
      }),
    );
    const response = await createWithLink('https://fake.example/r/2');
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ text: null, link: 'https://fake.example/r/2' });
  });

  it('leaves non-provider links untouched', async () => {
    await setup(
      fakeProvider(async () => ({
        title: 'nope',
        imageUrl: null,
        servings: null,
        ingredients: [],
      })),
    );
    const response = await createWithLink('https://elsewhere.example/r/3');
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ text: null });
  });

  it('enriches on PATCH when a link replaces the text', async () => {
    await setup(
      fakeProvider(async () => ({
        title: 'Curry',
        imageUrl: null,
        servings: null,
        ingredients: [],
      })),
    );
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/plan/entries',
      headers: { authorization: `Bearer ${token}` },
      payload: { date: '2026-11-21', slotId, text: 'Platzhalter' },
    });
    const entry = created.json() as { id: string };

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/plan/entries/${entry.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { text: '', link: 'https://fake.example/r/4' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ text: 'Curry', link: 'https://fake.example/r/4' });
  });
});

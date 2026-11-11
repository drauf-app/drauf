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

    it('cascades entries when a slot is deleted', async () => {
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
      expect(entries.json()).toEqual([]);
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

    it('keeps one entry per day and slot', async () => {
      await addEntry({ date: '2026-11-16', slotId: lunch.id, text: 'Pasta' });
      const duplicate = await addEntry({ date: '2026-11-16', slotId: lunch.id, text: 'Curry' });
      expect(duplicate.statusCode).toBe(409);
      expect(duplicate.json()).toEqual({ error: 'slot_occupied' });
    });

    it('moves entries to free days and refuses occupied ones (W6)', async () => {
      const entry = (await (
        await addEntry({ date: '2026-11-16', slotId: lunch.id, text: 'Pasta' })
      ).json()) as PlanEntry;
      await addEntry({ date: '2026-11-17', slotId: lunch.id, text: 'Curry' });

      const blocked = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/plan/entries/${entry.id}`,
        headers: as(kathrin),
        payload: { date: '2026-11-17' },
      });
      expect(blocked.statusCode).toBe(409);

      const moved = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/plan/entries/${entry.id}`,
        headers: as(kathrin),
        payload: { date: '2026-11-18', slotId: dinner.id },
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json()).toMatchObject({ date: '2026-11-18', slotId: dinner.id, text: 'Pasta' });

      // Editing without moving must not collide with itself.
      const selfEdit = await ctx.app.inject({
        method: 'PATCH',
        url: `/api/plan/entries/${entry.id}`,
        headers: as(christian),
        payload: { text: 'Pasta al forno' },
      });
      expect(selfEdit.statusCode).toBe(200);
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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EntryView } from '../src/lists/items.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('list entry routes', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let kathrin: { id: string; token: string };
  let listId: string;

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

  async function addItem(payload: object, user = christian) {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(user),
      payload,
    });
  }

  async function getEntries(user = christian): Promise<EntryView[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${listId}/entries`,
      headers: as(user),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    christian = await createAndLogin('christian');
    kathrin = await createAndLogin('kathrin');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers: as(christian),
      payload: { name: 'Weekly shop' },
    });
    listId = (created.json() as { id: string }).id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('merges the same item and sums equal units (L4)', async () => {
    const first = await addItem({ name: 'Hack', quantity: 200, unit: 'g' });
    expect(first.statusCode).toBe(201);
    const second = await addItem({ name: 'Hack', quantity: 300, unit: 'g' }, kathrin);
    expect(second.statusCode).toBe(200);

    const entries = await getEntries();
    expect(entries).toHaveLength(1);
    const entry = entries[0] as EntryView;
    expect(entry.quantities).toEqual([{ unit: 'g', quantity: 500 }]);
    // Both partial quantities stay traceable, incl. who added them.
    expect(entry.portions).toHaveLength(2);
    expect(entry.portions.map((p) => p.addedById)).toEqual([christian.id, kathrin.id]);
    expect(entry.portions.every((p) => p.origin === 'manual')).toBe(true);
  });

  it('keeps different units side by side without conversion', async () => {
    await addItem({ name: 'Zwiebeln', quantity: 1, unit: 'Stück' });
    await addItem({ name: 'Zwiebeln', quantity: 50, unit: 'g' });

    const [entry] = await getEntries();
    expect(entry?.quantities).toEqual([
      { unit: 'Stück', quantity: 1 },
      { unit: 'g', quantity: 50 },
    ]);
  });

  it('merges case- and whitespace-insensitively, keeping the first spelling', async () => {
    await addItem({ name: 'Zwiebeln' });
    await addItem({ name: '  zwiebeln ' });

    const entries = await getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('Zwiebeln');
  });

  it('treats different varieties as separate entries', async () => {
    await addItem({ name: 'Nudeln', variant: 'Fusilli', quantity: 500, unit: 'g' });
    await addItem({ name: 'Nudeln', variant: 'Penne', quantity: 500, unit: 'g' });
    await addItem({ name: 'Nudeln', variant: 'Fusilli', quantity: 500, unit: 'g' });

    const entries = await getEntries();
    expect(entries).toHaveLength(2);
    const fusilli = entries.find((e) => e.variant === 'Fusilli');
    expect(fusilli?.quantities).toEqual([{ unit: 'g', quantity: 1000 }]);
  });

  it('does not merge into checked entries; they remain as recently bought', async () => {
    const created = (await (await addItem({ name: 'Milch', quantity: 1, unit: 'l' })).json()) as {
      id: string;
    };
    const checked = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries/${created.id}/check`,
      headers: as(kathrin),
    });
    expect(checked.statusCode).toBe(200);
    expect((checked.json() as EntryView).checkedById).toBe(kathrin.id);
    expect((checked.json() as EntryView).checkedAt).not.toBeNull();

    const readded = await addItem({ name: 'Milch', quantity: 2, unit: 'l' });
    expect(readded.statusCode).toBe(201);

    const entries = await getEntries();
    expect(entries).toHaveLength(2);
    const active = entries.filter((e) => e.checkedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]?.quantities).toEqual([{ unit: 'l', quantity: 2 }]);
  });

  it('unchecks entries again', async () => {
    const created = (await (await addItem({ name: 'Milch' })).json()) as { id: string };
    await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries/${created.id}/check`,
      headers: as(christian),
    });
    const unchecked = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries/${created.id}/uncheck`,
      headers: as(christian),
    });
    expect((unchecked.json() as EntryView).checkedAt).toBeNull();
    expect((unchecked.json() as EntryView).checkedById).toBeNull();
  });

  it('adopts a note on merge only when the entry has none', async () => {
    await addItem({ name: 'Brot' });
    await addItem({ name: 'Brot', note: 'Vollkorn' });
    await addItem({ name: 'Brot', note: 'Weißbrot' });

    const [entry] = await getEntries();
    expect(entry?.note).toBe('Vollkorn');
  });

  it('edits fields and replaces portions on explicit quantity edits', async () => {
    await addItem({ name: 'Hack', quantity: 200, unit: 'g' });
    const merged = (await (await addItem({ name: 'Hack', quantity: 300, unit: 'g' })).json()) as {
      id: string;
    };

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${merged.id}`,
      headers: as(kathrin),
      payload: { name: 'Rinderhack', quantity: 750, unit: 'g', note: 'mager' },
    });
    expect(patched.statusCode).toBe(200);
    const view = patched.json() as EntryView;
    expect(view.name).toBe('Rinderhack');
    expect(view.note).toBe('mager');
    expect(view.portions).toHaveLength(1);
    expect(view.quantities).toEqual([{ unit: 'g', quantity: 750 }]);

    const cleared = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${merged.id}`,
      headers: as(kathrin),
      payload: { note: '' },
    });
    expect((cleared.json() as EntryView).note).toBeNull();
  });

  it('remembers a picked icon on the household item and across re-adds (#43)', async () => {
    // Unknown item: no catalogue match, no icon.
    const created = (await addItem({ name: 'Zaubertrank' })).json() as EntryView;
    expect(created.icon).toBeNull();

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${created.id}`,
      headers: as(christian),
      payload: { icon: '🧪' },
    });
    expect(patched.statusCode).toBe(200);
    expect((patched.json() as EntryView).icon).toBe('🧪');

    // The icon belongs to the item, so it survives delete + re-add.
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${listId}/entries/${created.id}`,
      headers: as(christian),
    });
    const readded = (await addItem({ name: 'Zaubertrank' })).json() as EntryView;
    expect(readded.icon).toBe('🧪');

    // A pick also overrides a catalogue match, and '' goes back to it.
    const milk = (await addItem({ name: 'Milch' })).json() as EntryView;
    expect(milk.icon).toBe('🥛');
    const overridden = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${milk.id}`,
      headers: as(christian),
      payload: { icon: '🧀' },
    });
    expect((overridden.json() as EntryView).icon).toBe('🧀');
    const cleared = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${listId}/entries/${milk.id}`,
      headers: as(christian),
      payload: { icon: '' },
    });
    expect((cleared.json() as EntryView).icon).toBe('🥛');
  });

  it('deletes entries', async () => {
    const created = (await (await addItem({ name: 'Milch' })).json()) as { id: string };
    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${listId}/entries/${created.id}`,
      headers: as(christian),
    });
    expect(deleted.statusCode).toBe(204);
    expect(await getEntries()).toHaveLength(0);
  });

  it('hides entries from non-members and foreign lists (nested ids)', async () => {
    const created = (await (await addItem({ name: 'Milch' })).json()) as { id: string };
    await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${listId}/members/${kathrin.id}`,
      headers: as(christian),
    });

    const asNonMember = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${listId}/entries`,
      headers: as(kathrin),
    });
    expect(asNonMember.statusCode).toBe(404);

    // An entry id of list A must not be reachable through kathrin's own list B.
    const other = await ctx.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers: as(kathrin),
      payload: { name: 'Own list' },
    });
    const otherListId = (other.json() as { id: string }).id;
    const crossList = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${otherListId}/entries/${created.id}/check`,
      headers: as(kathrin),
    });
    expect(crossList.statusCode).toBe(404);
  });

  it('validates payloads', async () => {
    for (const payload of [{ name: '' }, { name: 'ok', quantity: 0 }, { quantity: 1 }]) {
      expect((await addItem(payload)).statusCode, JSON.stringify(payload)).toBe(400);
    }
  });
});

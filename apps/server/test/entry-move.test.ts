import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EntryView } from '../src/lists/items.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

describe('entry.move (#116)', () => {
  let ctx: TestApp;
  let christian: { id: string; token: string };
  let kathrin: { id: string; token: string };
  let source: string;
  let target: string;

  function as(user: { token: string }) {
    return { authorization: `Bearer ${user.token}` };
  }

  async function loginUser(username: string) {
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

  async function createList(name: string): Promise<string> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/lists',
      headers: as(christian),
      payload: { name },
    });
    return (response.json() as { id: string }).id;
  }

  async function addEntry(listId: string, payload: object): Promise<EntryView> {
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
      payload,
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  async function entriesOf(listId: string, user = christian): Promise<EntryView[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${listId}/entries`,
      headers: as(user),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function move(listId: string, entryId: string, targetListId: string, user = christian) {
    return ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${listId}/entries/${entryId}/move`,
      headers: as(user),
      payload: { targetListId },
    });
  }

  async function suggestCount(q: string): Promise<number | undefined> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/catalog/suggest?q=${encodeURIComponent(q)}`,
      headers: as(christian),
    });
    const suggestions = response.json() as Array<{ source: string; count?: number }>;
    return suggestions.find((entry) => entry.source === 'history')?.count;
  }

  beforeEach(async () => {
    ctx = await createTestApp({}, { catalog: [] });
    christian = await loginUser('christian');
    kathrin = await loginUser('kathrin');
    source = await createList('Wocheneinkauf');
    target = await createList('Metzger');
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('moves an entry with its portions intact and without touching the history', async () => {
    const entry = await addEntry(source, { name: 'Hackfleisch', quantity: 500, unit: 'g' });
    expect(await suggestCount('hack')).toBe(1);

    const response = await move(source, entry.id, target);
    expect(response.statusCode).toBe(200);
    const moved = response.json() as EntryView;
    expect(moved.id).toBe(entry.id);
    expect(moved.listId).toBe(target);
    expect(moved.quantities).toEqual([{ unit: 'g', quantity: 500 }]);
    expect(moved.portions).toHaveLength(1);
    expect(moved.portions[0]?.origin).toBe('manual');

    expect(await entriesOf(source)).toEqual([]);
    expect((await entriesOf(target)).map((row) => row.id)).toEqual([entry.id]);
    // A move is neither an add nor an abandonment: the count stays at one.
    expect(await suggestCount('hack')).toBe(1);
  });

  it('merges into an open same-item entry on the target (L4), newer fields win', async () => {
    const existing = await addEntry(target, { name: 'Hackfleisch', quantity: 300, unit: 'g' });
    const entry = await addEntry(source, { name: 'Hackfleisch', quantity: 500, unit: 'g' });
    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${source}/entries/${entry.id}`,
      headers: as(christian),
      payload: { note: 'frisch von der Theke' },
    });
    expect(patched.statusCode).toBe(200);

    const response = await move(source, entry.id, target);
    expect(response.statusCode).toBe(200);
    const merged = response.json() as EntryView;
    expect(merged.id).toBe(existing.id);
    expect(merged.quantities).toEqual([{ unit: 'g', quantity: 800 }]);
    expect(merged.portions).toHaveLength(2);
    // The target had no note, so the moved entry's stamped note is adopted.
    expect(merged.note).toBe('frisch von der Theke');

    expect(await entriesOf(source)).toEqual([]);
    expect(await entriesOf(target)).toHaveLength(1);
  });

  it('keeps the target field when it is newer than the moved one', async () => {
    const entry = await addEntry(source, { name: 'Butter' });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${source}/entries/${entry.id}`,
      headers: as(christian),
      payload: { note: 'alte Notiz' },
    });
    const existing = await addEntry(target, { name: 'Butter' });
    await ctx.app.inject({
      method: 'PATCH',
      url: `/api/lists/${target}/entries/${existing.id}`,
      headers: as(christian),
      payload: { note: 'neuere Notiz' },
    });

    const response = await move(source, entry.id, target);
    expect((response.json() as EntryView).note).toBe('neuere Notiz');
  });

  it('transfers a checked entry whole instead of merging', async () => {
    await addEntry(target, { name: 'Milch' });
    const entry = await addEntry(source, { name: 'Milch' });
    const checked = await ctx.app.inject({
      method: 'POST',
      url: `/api/lists/${source}/entries/${entry.id}/check`,
      headers: as(christian),
    });
    expect(checked.statusCode).toBe(200);

    const response = await move(source, entry.id, target);
    expect(response.statusCode).toBe(200);
    const moved = response.json() as EntryView;
    expect(moved.id).toBe(entry.id);
    expect(moved.checkedAt).not.toBeNull();

    const rows = await entriesOf(target);
    expect(rows).toHaveLength(2);
  });

  it('rejects same-list and foreign-target moves', async () => {
    const entry = await addEntry(source, { name: 'Brot' });

    const same = await move(source, entry.id, source);
    expect(same.statusCode).toBe(400);
    expect(same.json()).toEqual({ error: 'same_list' });

    const removed = await ctx.app.inject({
      method: 'DELETE',
      url: `/api/lists/${target}/members/${kathrin.id}`,
      headers: as(christian),
    });
    expect(removed.statusCode).toBe(204);
    const foreign = await move(source, entry.id, target, kathrin);
    expect(foreign.statusCode).toBe(404);

    const unknown = await move(source, entry.id, 'no-such-list');
    expect(unknown.statusCode).toBe(404);

    // Nothing moved along the way.
    expect((await entriesOf(source)).map((row) => row.id)).toEqual([entry.id]);
  });

  it('applies the sync op once and answers duplicate on replay', async () => {
    const entry = await addEntry(source, { name: 'Äpfel', quantity: 1, unit: 'kg' });
    const operation = {
      id: 'op-move-1',
      type: 'entry.move',
      time: new Date().toISOString(),
      data: { listId: source, entryId: entry.id, targetListId: target },
    };

    const first = await ctx.app.inject({
      method: 'POST',
      url: '/api/sync/operations',
      headers: as(christian),
      payload: { operations: [operation] },
    });
    expect(first.statusCode).toBe(200);
    const [applied] = (first.json() as { results: Array<{ status: string; entryId?: string }> })
      .results;
    expect(applied).toMatchObject({ status: 'applied', entryId: entry.id });
    expect(await entriesOf(source)).toEqual([]);
    expect(await entriesOf(target)).toHaveLength(1);

    const replay = await ctx.app.inject({
      method: 'POST',
      url: '/api/sync/operations',
      headers: as(christian),
      payload: { operations: [operation] },
    });
    const [again] = (replay.json() as { results: Array<{ status: string }> }).results;
    expect(again?.status).toBe('duplicate');
    expect(await entriesOf(target)).toHaveLength(1);
  });
});

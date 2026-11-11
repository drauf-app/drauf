import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EntryView } from '../src/lists/items.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

/** Buffers incoming messages so tests can await them without races. */
class SocketClient {
  private readonly queue: WsMessage[] = [];
  private readonly waiters: Array<(message: WsMessage) => void> = [];
  readonly closed: Promise<{ code: number }>;

  constructor(readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as WsMessage;
      const waiter = this.waiters.shift();
      if (waiter === undefined) {
        this.queue.push(message);
      } else {
        waiter(message);
      }
    });
    this.closed = new Promise((resolve) => {
      socket.addEventListener('close', (event) => resolve({ code: event.code }));
    });
  }

  next(timeoutMs = 2000): Promise<WsMessage> {
    const queued = this.queue.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for message')), timeoutMs);
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message));
  }

  close(): void {
    this.socket.close();
  }
}

describe('sync', () => {
  let ctx: TestApp;
  let port: number;
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

  async function connect(user: { token: string }): Promise<SocketClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/sync/socket`);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error('connect failed')));
    });
    const client = new SocketClient(socket);
    client.send({ type: 'auth', token: user.token });
    expect((await client.next()).type).toBe('auth_ok');
    return client;
  }

  async function runOps(operations: object[], user = christian) {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/sync/operations',
      headers: as(user),
      payload: { operations },
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { results: Array<Record<string, unknown>> }).results;
  }

  async function getEntries(): Promise<EntryView[]> {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/api/lists/${listId}/entries`,
      headers: as(christian),
    });
    return response.json();
  }

  beforeEach(async () => {
    ctx = await createTestApp();
    await ctx.app.listen({ host: '127.0.0.1', port: 0 });
    port = (ctx.app.server.address() as AddressInfo).port;
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

  describe('offline operations', () => {
    it('applies adds idempotently by operation id', async () => {
      const op = {
        id: randomUUID(),
        type: 'entry.add',
        time: new Date().toISOString(),
        data: { listId, name: 'Milch', quantity: 1, unit: 'l' },
      };
      const [first] = await runOps([op]);
      expect(first).toMatchObject({ status: 'applied' });

      const [replay] = await runOps([op]);
      expect(replay).toMatchObject({ status: 'duplicate' });
      expect(await getEntries()).toHaveLength(1);
    });

    it('merges offline adds like online ones', async () => {
      await runOps([
        {
          id: randomUUID(),
          type: 'entry.add',
          time: new Date().toISOString(),
          data: { listId, name: 'Hack', quantity: 200, unit: 'g' },
        },
        {
          id: randomUUID(),
          type: 'entry.add',
          time: new Date().toISOString(),
          data: { listId, name: 'hack', quantity: 300, unit: 'g' },
        },
      ]);
      const entries = await getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]?.quantities).toEqual([{ unit: 'g', quantity: 500 }]);
    });

    it('resolves field conflicts per field by timestamp', async () => {
      const [added] = await runOps([
        {
          id: randomUUID(),
          type: 'entry.add',
          time: new Date().toISOString(),
          data: { listId, name: 'Brot' },
        },
      ]);
      const entryId = added?.entryId as string;
      const t1 = new Date().toISOString();
      const t0 = new Date(Date.now() - 60_000).toISOString();

      const [recent] = await runOps([
        {
          id: randomUUID(),
          type: 'entry.setFields',
          time: t1,
          data: { listId, entryId, fields: { note: 'Vollkorn' } },
        },
      ]);
      expect(recent).toMatchObject({ status: 'applied' });

      // Older write to the same field loses...
      const [stale] = await runOps(
        [
          {
            id: randomUUID(),
            type: 'entry.setFields',
            time: t0,
            data: { listId, entryId, fields: { note: 'Weißbrot' } },
          },
        ],
        kathrin,
      );
      expect(stale).toMatchObject({ status: 'conflict' });

      // ...but an older write to an untouched field still applies, and a mixed
      // operation applies only its winning fields.
      const [mixed] = await runOps(
        [
          {
            id: randomUUID(),
            type: 'entry.setFields',
            time: t0,
            data: { listId, entryId, fields: { note: 'Roggen', variant: 'Sauerteig' } },
          },
        ],
        kathrin,
      );
      expect(mixed).toMatchObject({ status: 'applied' });

      const [entry] = await getEntries();
      expect(entry).toMatchObject({ note: 'Vollkorn', variant: 'Sauerteig' });
    });

    it('lets a check-off win over an older uncheck, edits keep checked state', async () => {
      const [added] = await runOps([
        {
          id: randomUUID(),
          type: 'entry.add',
          time: new Date().toISOString(),
          data: { listId, name: 'Milch' },
        },
      ]);
      const entryId = added?.entryId as string;
      const checkTime = new Date().toISOString();
      await runOps([
        { id: randomUUID(), type: 'entry.check', time: checkTime, data: { listId, entryId } },
      ]);

      const [staleUncheck] = await runOps(
        [
          {
            id: randomUUID(),
            type: 'entry.uncheck',
            time: new Date(Date.parse(checkTime) - 30_000).toISOString(),
            data: { listId, entryId },
          },
        ],
        kathrin,
      );
      expect(staleUncheck).toMatchObject({ status: 'conflict' });

      const [edit] = await runOps([
        {
          id: randomUUID(),
          type: 'entry.setFields',
          time: new Date().toISOString(),
          data: { listId, entryId, fields: { note: 'fettarm' } },
        },
      ]);
      expect(edit).toMatchObject({ status: 'applied' });
      const [entry] = await getEntries();
      expect(entry?.checkedAt).not.toBeNull();
      expect(entry?.note).toBe('fettarm');

      const [laterUncheck] = await runOps([
        {
          id: randomUUID(),
          type: 'entry.uncheck',
          time: new Date(Date.now() + 1000).toISOString(),
          data: { listId, entryId },
        },
      ]);
      expect(laterUncheck).toMatchObject({ status: 'applied' });
    });

    it('caps client timestamps at the server clock', async () => {
      const [added] = await runOps([
        {
          id: randomUUID(),
          type: 'entry.add',
          time: new Date().toISOString(),
          data: { listId, name: 'Brot' },
        },
      ]);
      const entryId = added?.entryId as string;
      await runOps([
        {
          id: randomUUID(),
          type: 'entry.setFields',
          time: '2999-01-01T00:00:00.000Z',
          data: { listId, entryId, fields: { note: 'from the future' } },
        },
      ]);
      // A write with the real current time still wins against the capped one.
      const [now] = await runOps(
        [
          {
            id: randomUUID(),
            type: 'entry.setFields',
            time: new Date(Date.now() + 10).toISOString(),
            data: { listId, entryId, fields: { note: 'from the present' } },
          },
        ],
        kathrin,
      );
      expect(now).toMatchObject({ status: 'applied' });
    });

    it('rejects operations on lists the user cannot access', async () => {
      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/lists/${listId}/members/${kathrin.id}`,
        headers: as(christian),
      });
      const [result] = await runOps(
        [
          {
            id: randomUUID(),
            type: 'entry.add',
            time: new Date().toISOString(),
            data: { listId, name: 'Spion' },
          },
        ],
        kathrin,
      );
      expect(result).toMatchObject({ status: 'rejected', error: 'not_found' });
    });

    it('treats deletes as idempotent', async () => {
      const [added] = await runOps([
        {
          id: randomUUID(),
          type: 'entry.add',
          time: new Date().toISOString(),
          data: { listId, name: 'Milch' },
        },
      ]);
      const entryId = added?.entryId as string;
      for (let i = 0; i < 2; i += 1) {
        const [result] = await runOps([
          {
            id: randomUUID(),
            type: 'entry.delete',
            time: new Date().toISOString(),
            data: { listId, entryId },
          },
        ]);
        expect(result).toMatchObject({ status: 'applied' });
      }
    });
  });

  describe('websocket', () => {
    it('authenticates, subscribes and receives entry events', async () => {
      const client = await connect(kathrin);
      client.send({ type: 'subscribe', lists: [listId], plan: true });
      const subscribed = await client.next();
      expect(subscribed.type).toBe('subscribed');
      expect(subscribed.topics).toHaveLength(2);

      await ctx.app.inject({
        method: 'POST',
        url: `/api/lists/${listId}/entries`,
        headers: as(christian),
        payload: { name: 'Milch', quantity: 1, unit: 'l' },
      });
      const event = await client.next();
      expect(event).toMatchObject({
        type: 'event',
        topic: `list:${listId}`,
        event: { type: 'entry.created' },
      });

      client.send({ type: 'ping' });
      expect((await client.next()).type).toBe('pong');
      client.close();
    });

    it('broadcasts offline-replayed operations too', async () => {
      const client = await connect(christian);
      client.send({ type: 'subscribe', lists: [listId] });
      await client.next();

      await runOps(
        [
          {
            id: randomUUID(),
            type: 'entry.add',
            time: new Date().toISOString(),
            data: { listId, name: 'Brot' },
          },
        ],
        kathrin,
      );
      const event = await client.next();
      expect(event).toMatchObject({ type: 'event', event: { type: 'entry.created' } });
      client.close();
    });

    it('closes unauthenticated connections and skips foreign subscriptions', async () => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/api/sync/socket`);
      const client = new SocketClient(socket);
      await new Promise<void>((resolve) => socket.addEventListener('open', () => resolve()));
      client.send({ type: 'auth', token: 'garbage' });
      expect((await client.closed).code).toBe(4401);

      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/lists/${listId}/members/${kathrin.id}`,
        headers: as(christian),
      });
      const foreign = await connect(kathrin);
      foreign.send({ type: 'subscribe', lists: [listId] });
      const subscribed = await foreign.next();
      expect(subscribed.topics).toEqual([]);
      foreign.close();
    });

    it('evicts removed members from the list topic', async () => {
      const client = await connect(kathrin);
      client.send({ type: 'subscribe', lists: [listId] });
      await client.next();

      await ctx.app.inject({
        method: 'DELETE',
        url: `/api/lists/${listId}/members/${kathrin.id}`,
        headers: as(christian),
      });
      const messages = [await client.next(), await client.next()];
      const types = messages.map((m) =>
        m.type === 'event' ? (m.event as { type: string }).type : m.type,
      );
      expect(types).toContain('member.removed');
      expect(types).toContain('evicted');
      client.close();
    });
  });
});

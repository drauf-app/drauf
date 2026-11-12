import { describe, expect, it } from 'vitest';
import {
  enqueueOp,
  flushQueue,
  newLocalEntryId,
  newOpId,
  pendingOps,
  resetOfflineForTests,
} from '../src/lib/offline';
import { fakeResponse, stubFetch } from './fake-fetch';

function queueAddAndFollowUps(localId: string): void {
  enqueueOp({
    id: newOpId(),
    type: 'entry.add',
    time: '2026-11-12T10:00:00.000Z',
    localEntryId: localId,
    data: { listId: 'l1', name: 'Milch', quantity: 1, unit: 'l' },
  });
  enqueueOp({
    id: newOpId(),
    type: 'entry.setFields',
    time: '2026-11-12T10:00:01.000Z',
    data: { listId: 'l1', entryId: localId, fields: { variant: 'Hafer' } },
  });
  enqueueOp({
    id: newOpId(),
    type: 'entry.check',
    time: '2026-11-12T10:00:02.000Z',
    data: { listId: 'l1', entryId: localId },
  });
}

interface OpsBody {
  operations: Array<{ id: string; type: string; data: Record<string, unknown> }>;
}

describe('offline operation queue', () => {
  it('replays in order and maps placeholder ids onto the server entry id', async () => {
    const localId = newLocalEntryId();
    queueAddAndFollowUps(localId);
    const bodies: OpsBody[] = [];
    stubFetch((url, init) => {
      if (url !== '/api/sync/operations') return undefined;
      const body = JSON.parse(String(init?.body)) as OpsBody;
      bodies.push(body);
      const op = body.operations[0];
      return fakeResponse(200, {
        results: [{ id: op?.id, status: 'applied', entryId: 'e9' }],
      });
    });

    expect(await flushQueue()).toBe(true);

    expect(bodies).toHaveLength(3);
    expect(bodies.map((body) => body.operations[0]?.type)).toEqual([
      'entry.add',
      'entry.setFields',
      'entry.check',
    ]);
    expect(bodies[1]?.operations[0]?.data.entryId).toBe('e9');
    expect(bodies[2]?.operations[0]?.data.entryId).toBe('e9');
    expect(pendingOps()).toHaveLength(0);
  });

  it('keeps the rest of the queue when connectivity drops mid-flush', async () => {
    const localId = newLocalEntryId();
    queueAddAndFollowUps(localId);
    let calls = 0;
    stubFetch((url, init) => {
      if (url !== '/api/sync/operations') return undefined;
      calls += 1;
      if (calls > 1) return undefined; // network drops after the add
      const body = JSON.parse(String(init?.body)) as OpsBody;
      return fakeResponse(200, {
        results: [{ id: body.operations[0]?.id, status: 'applied', entryId: 'e9' }],
      });
    });

    expect(await flushQueue()).toBe(false);
    expect(pendingOps()).toHaveLength(2);

    // The learned id mapping survives a reload via storage.
    resetOfflineForTests();
    const bodies: OpsBody[] = [];
    stubFetch((url, init) => {
      if (url !== '/api/sync/operations') return undefined;
      const body = JSON.parse(String(init?.body)) as OpsBody;
      bodies.push(body);
      return fakeResponse(200, { results: [{ id: body.operations[0]?.id, status: 'applied' }] });
    });
    expect(await flushQueue()).toBe(true);
    expect(bodies[0]?.operations[0]?.data.entryId).toBe('e9');
    expect(pendingOps()).toHaveLength(0);
  });

  it('drops operations the server rejects permanently and moves on', async () => {
    enqueueOp({
      id: newOpId(),
      type: 'entry.delete',
      time: '2026-11-12T10:00:00.000Z',
      data: { listId: 'l1', entryId: 'gone' },
    });
    enqueueOp({
      id: newOpId(),
      type: 'entry.check',
      time: '2026-11-12T10:00:01.000Z',
      data: { listId: 'l1', entryId: 'e1' },
    });
    let calls = 0;
    stubFetch((url, init) => {
      if (url !== '/api/sync/operations') return undefined;
      calls += 1;
      if (calls === 1) return fakeResponse(400, { error: 'invalid_payload' });
      const body = JSON.parse(String(init?.body)) as OpsBody;
      return fakeResponse(200, { results: [{ id: body.operations[0]?.id, status: 'applied' }] });
    });

    expect(await flushQueue()).toBe(true);
    expect(calls).toBe(2);
    expect(pendingOps()).toHaveLength(0);
  });

  it('drops follow-ups whose offline add never reached the server', async () => {
    enqueueOp({
      id: newOpId(),
      type: 'entry.check',
      time: '2026-11-12T10:00:00.000Z',
      data: { listId: 'l1', entryId: newLocalEntryId() },
    });
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return fakeResponse(200, { results: [] });
    });

    expect(await flushQueue()).toBe(true);
    expect(calls).toBe(0);
    expect(pendingOps()).toHaveLength(0);
  });
});

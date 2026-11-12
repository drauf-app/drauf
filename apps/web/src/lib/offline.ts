import { ApiError, apiFetch } from '../auth/store';

export type OfflineOpType =
  | 'entry.add'
  | 'entry.setFields'
  | 'entry.check'
  | 'entry.uncheck'
  | 'entry.delete';

export interface OfflineOp {
  /** Client-generated operation id; the server deduplicates replays by it. */
  id: string;
  type: OfflineOpType;
  /** Wall-clock time of the action (ISO 8601), used for per-field LWW. */
  time: string;
  data: Record<string, unknown>;
  /** Set on entry.add ops: the placeholder entry id used locally. */
  localEntryId?: string;
}

interface QueueState {
  ops: OfflineOp[];
  /** Placeholder entry id → server entry id, learned while flushing adds. */
  idMap: Record<string, string>;
}

interface SyncResult {
  id: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  entryId?: string;
}

const STORAGE_KEY = 'drauf.op-queue';
export const LOCAL_ENTRY_PREFIX = 'local-';

function load(): QueueState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as QueueState;
      if (Array.isArray(parsed.ops)) {
        return { ops: parsed.ops, idMap: parsed.idMap ?? {} };
      }
    }
  } catch {
    // Unreadable queue: start empty rather than blocking the app.
  }
  return { ops: [], idMap: {} };
}

let state = load();
let flushing = false;

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The queue then lives only as long as the page.
  }
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Insecure contexts (plain http on a LAN) lack randomUUID; operation ids
  // only need uniqueness, not unpredictability.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function newOpId(): string {
  return randomId();
}

export function newLocalEntryId(): string {
  return `${LOCAL_ENTRY_PREFIX}${randomId()}`;
}

export function isLocalEntryId(entryId: string): boolean {
  return entryId.startsWith(LOCAL_ENTRY_PREFIX);
}

export function pendingOps(): readonly OfflineOp[] {
  return state.ops;
}

export function enqueueOp(op: OfflineOp): void {
  state.ops.push(op);
  save();
}

/**
 * Replays queued operations in order, one request each, so placeholder entry
 * ids from offline adds can be resolved before later operations use them.
 * Stops on network failure (the queue is kept); permanently rejected
 * operations are dropped. Returns true when the queue drained.
 */
export async function flushQueue(): Promise<boolean> {
  if (flushing) {
    return false;
  }
  flushing = true;
  try {
    while (state.ops.length > 0) {
      const op = state.ops[0];
      if (op === undefined) {
        break;
      }
      const data = { ...op.data };
      if (typeof data.entryId === 'string' && isLocalEntryId(data.entryId)) {
        const mapped = state.idMap[data.entryId];
        if (mapped === undefined) {
          // The add this op depends on never reached the server (e.g. it was
          // rejected): the follow-up is meaningless.
          state.ops.shift();
          save();
          continue;
        }
        data.entryId = mapped;
      }
      try {
        const response = await apiFetch('/api/sync/operations', {
          method: 'POST',
          body: JSON.stringify({ operations: [{ id: op.id, type: op.type, time: op.time, data }] }),
        });
        const body = (await response.json()) as { results: SyncResult[] };
        const entryId = body.results[0]?.entryId;
        if (op.type === 'entry.add' && op.localEntryId !== undefined && entryId !== undefined) {
          state.idMap[op.localEntryId] = entryId;
        }
      } catch (err) {
        if (!(err instanceof ApiError)) {
          save();
          return false; // offline again: keep the queue for the next attempt
        }
        // A rejected request (schema, auth scope) will never succeed: drop it.
      }
      state.ops.shift();
      save();
    }
    state.idMap = {};
    save();
    return true;
  } finally {
    flushing = false;
  }
}

/** Test seam: re-reads the queue from storage (tests clear or seed it first). */
export function resetOfflineForTests(): void {
  state = load();
  flushing = false;
}

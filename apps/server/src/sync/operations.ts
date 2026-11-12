import type { CatalogIndex } from '@drauf/catalog';
import type { Database } from '../db/index.js';
import {
  deleteListEntry,
  getListEntry,
  getListHouseholdId,
  isCategoryLinkedToList,
  isOperationApplied,
  markOperationApplied,
  recordCatalogVariant,
  setEntryChecked,
  updateListEntry,
} from '../db/repositories.js';
import type { ListEntry } from '../db/schema/types.js';
import {
  addItemToList,
  getEntryView,
  normalizeItemName,
  replaceEntryQuantity,
} from '../lists/items.js';
import { getListForMember } from '../lists/service.js';
import { listTopic, type SyncHub } from './hub.js';

export const OPERATION_TYPES = [
  'entry.add',
  'entry.setFields',
  'entry.check',
  'entry.uncheck',
  'entry.delete',
] as const;

export type OperationType = (typeof OPERATION_TYPES)[number];

export interface SyncOperation {
  /** Client-generated unique id; replays become no-ops. */
  id: string;
  type: OperationType;
  /** Client wall-clock time of the action (ISO 8601). */
  time: string;
  data: Record<string, unknown>;
}

export interface SyncResult {
  id: string;
  status: 'applied' | 'duplicate' | 'conflict' | 'rejected';
  error?: string;
  entryId?: string;
}

export function parseFieldTimes(raw: string | null): Record<string, number> {
  if (raw === null) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const times: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number') {
        times[key] = value;
      }
    }
    return times;
  } catch {
    return {};
  }
}

export function stampFieldTimes(raw: string | null, fields: string[], time: number): string {
  const times = parseFieldTimes(raw);
  for (const field of fields) {
    times[field] = time;
  }
  return JSON.stringify(times);
}

function optionalString(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new OperationError('invalid_payload');
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

class OperationError extends Error {
  readonly status: 'rejected' | 'conflict';

  constructor(message: string, status: 'rejected' | 'conflict' = 'rejected') {
    super(message);
    this.status = status;
  }
}

interface Context {
  database: Database;
  hub: SyncHub;
  userId: string;
  effectiveTime: number;
  catalog: CatalogIndex | undefined;
}

function requireString(value: unknown, maxLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new OperationError('invalid_payload');
  }
  return value;
}

async function requireListAccess(ctx: Context, data: Record<string, unknown>): Promise<string> {
  const listId = requireString(data.listId, 64);
  const list = await getListForMember(ctx.database, listId, ctx.userId);
  if (list === undefined) {
    throw new OperationError('not_found');
  }
  return listId;
}

async function requireEntry(ctx: Context, data: Record<string, unknown>): Promise<ListEntry> {
  const listId = await requireListAccess(ctx, data);
  const entry = await getListEntry(ctx.database, listId, requireString(data.entryId, 64));
  if (entry === undefined) {
    throw new OperationError('not_found');
  }
  return entry;
}

async function publishEntry(ctx: Context, type: string, entry: ListEntry): Promise<void> {
  ctx.hub.publish(listTopic(entry.listId), {
    type,
    data: await getEntryView(ctx.database, entry, ctx.catalog),
  });
}

async function applyAdd(ctx: Context, data: Record<string, unknown>): Promise<SyncResult> {
  const listId = await requireListAccess(ctx, data);
  const name = requireString(data.name, 100);
  const quantity = data.quantity === undefined ? undefined : Number(data.quantity);
  if (quantity !== undefined && (!Number.isFinite(quantity) || quantity <= 0)) {
    throw new OperationError('invalid_payload');
  }
  const categoryId = optionalString(data.categoryId, 64) ?? null;
  if (categoryId !== null && !(await isCategoryLinkedToList(ctx.database, listId, categoryId))) {
    throw new OperationError('invalid_category');
  }
  const unit = optionalString(data.unit, 32);
  const variant = optionalString(data.variant, 64);
  const note = optionalString(data.note, 500);
  const { entry, merged } = await addItemToList(
    ctx.database,
    listId,
    ctx.userId,
    {
      name,
      ...(quantity === undefined ? {} : { quantity }),
      ...(unit == null ? {} : { unit }),
      ...(variant == null ? {} : { variant }),
      ...(note == null ? {} : { note }),
      categoryId,
    },
    'manual',
    ctx.catalog,
  );
  await publishEntry(ctx, merged ? 'entry.updated' : 'entry.created', entry);
  return { id: '', status: 'applied', entryId: entry.id };
}

async function applySetFields(ctx: Context, data: Record<string, unknown>): Promise<SyncResult> {
  const entry = await requireEntry(ctx, data);
  const fields = data.fields;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
    throw new OperationError('invalid_payload');
  }
  const input = fields as Record<string, unknown>;
  const clocks = parseFieldTimes(entry.fieldTimes);
  const wins = (field: string) => ctx.effectiveTime >= (clocks[field] ?? 0);

  const patch: Parameters<typeof updateListEntry>[2] = {};
  const stamped: string[] = [];
  let lost = false;

  const scalarFields = [
    ['name', 100],
    ['variant', 64],
    ['note', 500],
    ['categoryId', 64],
  ] as const;
  for (const [field, maxLength] of scalarFields) {
    const value = optionalString(input[field], maxLength);
    if (value === undefined) {
      continue;
    }
    if (!wins(field)) {
      lost = true;
      continue;
    }
    if (field === 'name') {
      if (value === null) {
        throw new OperationError('invalid_payload');
      }
      patch.name = value;
      patch.nameNormalized = normalizeItemName(value);
    } else if (field === 'categoryId') {
      if (value !== null && !(await isCategoryLinkedToList(ctx.database, entry.listId, value))) {
        throw new OperationError('invalid_category');
      }
      patch.categoryId = value;
    } else {
      patch[field] = value;
    }
    stamped.push(field);
  }

  const hasQuantity = input.quantity !== undefined || input.unit !== undefined;
  if (hasQuantity) {
    const quantity =
      input.quantity === undefined || input.quantity === null ? null : Number(input.quantity);
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
      throw new OperationError('invalid_payload');
    }
    if (wins('quantity')) {
      const unit = optionalString(input.unit, 32);
      await replaceEntryQuantity(ctx.database, entry, ctx.userId, quantity, unit ?? undefined);
      stamped.push('quantity');
    } else {
      lost = true;
    }
  }

  if (stamped.length === 0) {
    return { id: '', status: lost ? 'conflict' : 'rejected', entryId: entry.id };
  }
  patch.fieldTimes = stampFieldTimes(entry.fieldTimes, stamped, ctx.effectiveTime);
  await updateListEntry(ctx.database, entry.id, patch);
  if (typeof patch.variant === 'string') {
    // Custom chips learn from every applied variant, also on offline replay.
    const householdId = await getListHouseholdId(ctx.database, entry.listId);
    if (householdId !== undefined) {
      await recordCatalogVariant(ctx.database, householdId, entry.nameNormalized, patch.variant);
    }
  }
  await publishEntry(ctx, 'entry.updated', { ...entry, ...patch });
  return { id: '', status: 'applied', entryId: entry.id };
}

async function applyCheck(ctx: Context, data: Record<string, unknown>): Promise<SyncResult> {
  const entry = await requireEntry(ctx, data);
  if (entry.checkedAt !== null) {
    // Already checked: keep the earlier check-off, replay is a no-op.
    return { id: '', status: 'applied', entryId: entry.id };
  }
  const state = { checkedAt: new Date(ctx.effectiveTime), checkedById: ctx.userId };
  await setEntryChecked(ctx.database, entry.id, state);
  await publishEntry(ctx, 'entry.checked', { ...entry, ...state });
  return { id: '', status: 'applied', entryId: entry.id };
}

async function applyUncheck(ctx: Context, data: Record<string, unknown>): Promise<SyncResult> {
  const entry = await requireEntry(ctx, data);
  if (entry.checkedAt === null) {
    return { id: '', status: 'applied', entryId: entry.id };
  }
  if (ctx.effectiveTime <= entry.checkedAt.getTime()) {
    // A check-off wins over a concurrent (or stale) uncheck.
    return { id: '', status: 'conflict', entryId: entry.id };
  }
  const state = { checkedAt: null, checkedById: null };
  await setEntryChecked(ctx.database, entry.id, state);
  await publishEntry(ctx, 'entry.unchecked', { ...entry, ...state });
  return { id: '', status: 'applied', entryId: entry.id };
}

async function applyDelete(ctx: Context, data: Record<string, unknown>): Promise<SyncResult> {
  const listId = await requireListAccess(ctx, data);
  const entryId = requireString(data.entryId, 64);
  const entry = await getListEntry(ctx.database, listId, entryId);
  if (entry === undefined) {
    // Already gone: deletion is idempotent.
    return { id: '', status: 'applied', entryId };
  }
  await deleteListEntry(ctx.database, entry.id);
  ctx.hub.publish(listTopic(listId), { type: 'entry.deleted', data: { id: entry.id, listId } });
  return { id: '', status: 'applied', entryId: entry.id };
}

async function applyOne(ctx: Context, operation: SyncOperation): Promise<SyncResult> {
  switch (operation.type) {
    case 'entry.add':
      return applyAdd(ctx, operation.data);
    case 'entry.setFields':
      return applySetFields(ctx, operation.data);
    case 'entry.check':
      return applyCheck(ctx, operation.data);
    case 'entry.uncheck':
      return applyUncheck(ctx, operation.data);
    case 'entry.delete':
      return applyDelete(ctx, operation.data);
  }
}

/**
 * Applies a client's queued operations in order. Client timestamps decide
 * field-level last-write-wins but are capped at the server clock, so a skewed
 * client cannot claim the future. Conflict outcomes are recorded like applied
 * ones: replaying the same operation id always answers `duplicate`.
 */
export async function applyOperations(
  database: Database,
  hub: SyncHub,
  userId: string,
  operations: SyncOperation[],
  catalog?: CatalogIndex,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const operation of operations) {
    if (await isOperationApplied(database, operation.id)) {
      results.push({ id: operation.id, status: 'duplicate' });
      continue;
    }
    const clientTime = Date.parse(operation.time);
    const ctx: Context = {
      database,
      hub,
      userId,
      catalog,
      effectiveTime: Math.min(Number.isNaN(clientTime) ? Date.now() : clientTime, Date.now()),
    };
    let result: SyncResult;
    try {
      result = { ...(await applyOne(ctx, operation)), id: operation.id };
    } catch (err) {
      result = {
        id: operation.id,
        status: err instanceof OperationError ? err.status : 'rejected',
        error: err instanceof OperationError ? err.message : 'internal_error',
      };
    }
    if (result.status !== 'rejected') {
      if (!(await markOperationApplied(database, operation.id, userId))) {
        result = { id: operation.id, status: 'duplicate' };
      }
    }
    results.push(result);
  }
  return results;
}

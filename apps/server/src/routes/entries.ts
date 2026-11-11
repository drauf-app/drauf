import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import {
  deleteListEntry,
  getListEntry,
  isCategoryLinkedToList,
  setEntryChecked,
  updateListEntry,
} from '../db/repositories.js';
import {
  addItemToList,
  getEntryView,
  getEntryViews,
  normalizeItemName,
  replaceEntryQuantity,
} from '../lists/items.js';
import { getListForMember } from '../lists/service.js';

const addBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    quantity: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
    unit: { type: 'string', maxLength: 32 },
    variant: { type: 'string', maxLength: 64 },
    note: { type: 'string', maxLength: 500 },
    categoryId: { type: 'string', maxLength: 64 },
  },
  additionalProperties: false,
} as const;

const patchBody = {
  type: 'object',
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    quantity: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
    unit: { type: 'string', maxLength: 32 },
    variant: { type: 'string', maxLength: 64 },
    note: { type: 'string', maxLength: 500 },
    categoryId: { type: 'string', maxLength: 64 },
  },
  additionalProperties: false,
} as const;

const listParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', maxLength: 64 } },
} as const;

const entryParams = {
  type: 'object',
  required: ['id', 'entryId'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    entryId: { type: 'string', maxLength: 64 },
  },
} as const;

interface AddInput {
  name: string;
  quantity?: number;
  unit?: string;
  variant?: string;
  note?: string;
  categoryId?: string;
}

interface PatchInput extends Partial<AddInput> {}

interface ListParamsInput {
  id: string;
}

interface EntryParamsInput {
  id: string;
  entryId: string;
}

function requireAuthUser(reply: FastifyReply, authUser: AuthUser | undefined): AuthUser {
  if (authUser === undefined) {
    reply.code(401);
    throw new Error('missing auth user');
  }
  return authUser;
}

export function entryRoutes(database: Database, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    /** Resolves list (membership) and, when given, the entry scoped to that list. */
    async function resolve(reply: FastifyReply, userId: string, listId: string, entryId?: string) {
      const list = await getListForMember(database, listId, userId);
      if (list === undefined) {
        await reply.code(404).send({ error: 'not_found' });
        return undefined;
      }
      if (entryId === undefined) {
        return { list, entry: undefined };
      }
      const entry = await getListEntry(database, listId, entryId);
      if (entry === undefined) {
        await reply.code(404).send({ error: 'not_found' });
        return undefined;
      }
      return { list, entry };
    }

    app.get<{ Params: ListParamsInput }>(
      '/:id/entries',
      { schema: { params: listParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const resolved = await resolve(reply, auth.id, request.params.id);
        if (resolved === undefined) return reply;
        return getEntryViews(database, request.params.id);
      },
    );

    app.post<{ Params: ListParamsInput; Body: AddInput }>(
      '/:id/entries',
      { schema: { params: listParams, body: addBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const resolved = await resolve(reply, auth.id, request.params.id);
        if (resolved === undefined) return reply;
        const categoryId = request.body.categoryId?.trim() || undefined;
        if (
          categoryId !== undefined &&
          !(await isCategoryLinkedToList(database, request.params.id, categoryId))
        ) {
          return reply.code(400).send({ error: 'invalid_category' });
        }
        const { entry, merged } = await addItemToList(database, request.params.id, auth.id, {
          ...request.body,
          categoryId: categoryId ?? null,
        });
        return reply.code(merged ? 200 : 201).send(await getEntryView(database, entry));
      },
    );

    app.patch<{ Params: EntryParamsInput; Body: PatchInput }>(
      '/:id/entries/:entryId',
      { schema: { params: entryParams, body: patchBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const resolved = await resolve(reply, auth.id, request.params.id, request.params.entryId);
        if (resolved?.entry === undefined) return reply;
        let entry = resolved.entry;

        const { name, variant, note, quantity, unit, categoryId } = request.body;
        const patch: Parameters<typeof updateListEntry>[2] = {};
        if (categoryId !== undefined) {
          const trimmed = categoryId.trim();
          if (trimmed === '') {
            patch.categoryId = null;
          } else if (await isCategoryLinkedToList(database, entry.listId, trimmed)) {
            patch.categoryId = trimmed;
          } else {
            return reply.code(400).send({ error: 'invalid_category' });
          }
        }
        if (name !== undefined) {
          patch.name = name.trim().replace(/\s+/g, ' ');
          patch.nameNormalized = normalizeItemName(name);
        }
        if (variant !== undefined) {
          patch.variant = variant.trim() === '' ? null : variant.trim();
        }
        if (note !== undefined) {
          patch.note = note.trim() === '' ? null : note.trim();
        }
        if (Object.keys(patch).length > 0) {
          await updateListEntry(database, entry.id, patch);
          entry = { ...entry, ...patch };
        }
        if (quantity !== undefined || unit !== undefined) {
          await replaceEntryQuantity(database, entry, auth.id, quantity ?? null, unit);
        }
        return getEntryView(database, entry);
      },
    );

    for (const [action, makeState] of [
      ['check', (auth: AuthUser) => ({ checkedAt: new Date(), checkedById: auth.id })],
      ['uncheck', () => ({ checkedAt: null, checkedById: null })],
    ] as const) {
      app.post<{ Params: EntryParamsInput }>(
        `/:id/entries/:entryId/${action}`,
        { schema: { params: entryParams } },
        async (request, reply) => {
          const auth = requireAuthUser(reply, request.authUser);
          const resolved = await resolve(reply, auth.id, request.params.id, request.params.entryId);
          if (resolved?.entry === undefined) return reply;
          const state = makeState(auth);
          await setEntryChecked(database, resolved.entry.id, state);
          return getEntryView(database, { ...resolved.entry, ...state });
        },
      );
    }

    app.delete<{ Params: EntryParamsInput }>(
      '/:id/entries/:entryId',
      { schema: { params: entryParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const resolved = await resolve(reply, auth.id, request.params.id, request.params.entryId);
        if (resolved?.entry === undefined) return reply;
        await deleteListEntry(database, resolved.entry.id);
        return reply.code(204).send();
      },
    );
  };
}

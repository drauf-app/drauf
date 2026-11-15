import type { CatalogIndex } from '@drauf/catalog';
import { ENTRY_FLAGS, joinVariants, splitVariants } from '@drauf/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { CategorizeService } from '../categorize/service.js';
import type { Database } from '../db/index.js';
import {
  deleteListEntry,
  getListEntry,
  getListHouseholdId,
  isCategoryLinkedToList,
  recordCatalogNote,
  recordCatalogVariant,
  setCatalogUsageCategory,
  setCatalogUsageIcon,
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
import { listTopic, type SyncHub } from '../sync/hub.js';
import { stampFieldTimes } from '../sync/operations.js';

const addBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    quantity: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
    unit: { type: 'string', maxLength: 32 },
    count: { type: 'integer', minimum: 1, maximum: 99 },
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
    count: { type: 'integer', minimum: 1, maximum: 99 },
    variant: { type: 'string', maxLength: 64 },
    flags: { type: 'string', maxLength: 128 },
    note: { type: 'string', maxLength: 500 },
    categoryId: { type: 'string', maxLength: 64 },
    /** Household item icon ('' = back to the catalogue match), not an entry field. */
    icon: { type: 'string', maxLength: 16 },
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
  count?: number;
  variant?: string;
  note?: string;
  categoryId?: string;
}

interface PatchInput extends Partial<AddInput> {
  /** Comma list of fixed shopping flags; '' clears them. */
  flags?: string;
  /** Household item icon ('' = back to the catalogue match), not an entry field. */
  icon?: string;
}

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

export function entryRoutes(
  database: Database,
  guards: AuthGuards,
  hub: SyncHub,
  catalog: CatalogIndex,
  categorize: CategorizeService | undefined,
): FastifyPluginAsync {
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
        return getEntryViews(database, request.params.id, catalog);
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
        const { entry, merged } = await addItemToList(
          database,
          request.params.id,
          auth.id,
          { ...request.body, categoryId: categoryId ?? null },
          'manual',
          catalog,
        );
        const view = await getEntryView(database, entry, catalog);
        hub.publish(listTopic(request.params.id), {
          type: merged ? 'entry.updated' : 'entry.created',
          data: view,
        });
        if (entry.categoryId === null) {
          // Optional third guessing tier, out-of-band of the add (#22).
          void categorize?.schedule(entry);
        }
        return reply.code(merged ? 200 : 201).send(view);
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

        const { name, variant, flags, note, quantity, unit, count, categoryId, icon } =
          request.body;
        const patch: Parameters<typeof updateListEntry>[2] = {};
        const editedFields: string[] = [];
        if (categoryId !== undefined) {
          const trimmed = categoryId.trim();
          if (trimmed === '') {
            patch.categoryId = null;
          } else if (await isCategoryLinkedToList(database, entry.listId, trimmed)) {
            patch.categoryId = trimmed;
          } else {
            return reply.code(400).send({ error: 'invalid_category' });
          }
          editedFields.push('categoryId');
        }
        if (name !== undefined) {
          patch.name = name.trim().replace(/\s+/g, ' ');
          patch.nameNormalized = normalizeItemName(name);
          editedFields.push('name');
        }
        if (variant !== undefined) {
          patch.variant = variant.trim() === '' ? null : variant.trim();
          editedFields.push('variant');
        }
        if (flags !== undefined) {
          const parsed = splitVariants(flags);
          if (parsed.some((flag) => !(ENTRY_FLAGS as readonly string[]).includes(flag))) {
            return reply.code(400).send({ error: 'invalid_flags' });
          }
          patch.flags = parsed.length === 0 ? null : joinVariants(parsed);
          editedFields.push('flags');
        }
        if (note !== undefined) {
          patch.note = note.trim() === '' ? null : note.trim();
          editedFields.push('note');
        }
        if (quantity !== undefined || unit !== undefined || count !== undefined) {
          await replaceEntryQuantity(
            database,
            entry,
            auth.id,
            quantity ?? null,
            unit,
            count ?? null,
          );
          editedFields.push('quantity');
        }
        if (editedFields.length > 0) {
          // Online edits participate in the same per-field clocks as offline sync.
          patch.fieldTimes = stampFieldTimes(entry.fieldTimes, editedFields, Date.now());
          await updateListEntry(database, entry.id, patch);
          entry = { ...entry, ...patch };
        }
        const appliedVariant = typeof patch.variant === 'string' ? patch.variant : undefined;
        const appliedNote = typeof patch.note === 'string' ? patch.note : undefined;
        if (
          patch.categoryId !== undefined ||
          appliedVariant !== undefined ||
          appliedNote !== undefined ||
          icon !== undefined
        ) {
          const householdId = await getListHouseholdId(database, entry.listId);
          if (householdId !== undefined) {
            if (icon !== undefined) {
              // The icon lives on the household's item, so it shows
              // everywhere and survives re-adds (#43).
              await setCatalogUsageIcon(
                database,
                householdId,
                entry.nameNormalized,
                icon.trim() === '' ? null : icon.trim(),
              );
            }
            if (patch.categoryId !== undefined) {
              // "Kategorie erfragt": remember the chosen category for next time (K3).
              await setCatalogUsageCategory(
                database,
                householdId,
                entry.nameNormalized,
                patch.categoryId,
              );
            }
            if (appliedVariant !== undefined) {
              // Custom chips learn from every applied variant (K2/K4).
              await recordCatalogVariant(
                database,
                householdId,
                entry.nameNormalized,
                appliedVariant,
              );
            }
            if (appliedNote !== undefined) {
              await recordCatalogNote(database, householdId, entry.nameNormalized, appliedNote);
            }
          }
        }
        const view = await getEntryView(database, entry, catalog);
        hub.publish(listTopic(entry.listId), { type: 'entry.updated', data: view });
        return view;
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
          const view = await getEntryView(database, { ...resolved.entry, ...state }, catalog);
          hub.publish(listTopic(resolved.entry.listId), {
            type: action === 'check' ? 'entry.checked' : 'entry.unchecked',
            data: view,
          });
          return view;
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
        hub.publish(listTopic(resolved.entry.listId), {
          type: 'entry.deleted',
          data: { id: resolved.entry.id, listId: resolved.entry.listId },
        });
        return reply.code(204).send();
      },
    );
  };
}

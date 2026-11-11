import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import {
  createMealSlot,
  createPlanEntry,
  deleteMealSlot,
  deletePlanEntry,
  findPlanEntryForSlot,
  getMealSlot,
  getPlanEntry,
  isHouseholdMember,
  listMealSlots,
  listPlanEntries,
  updateMealSlot,
  updatePlanEntry,
} from '../db/repositories.js';
import { getHouseholdForMember } from '../households/service.js';
import { planTopic, type SyncHub } from '../sync/hub.js';

const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
/** Longest range one query may span, in whole days. */
const MAX_RANGE_DAYS = 92;

const slotBody = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
  additionalProperties: false,
} as const;

const slotPatchBody = {
  type: 'object',
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    sortOrder: { type: 'integer', minimum: 0, maximum: 1_000_000 },
  },
  additionalProperties: false,
} as const;

const entryBody = {
  type: 'object',
  required: ['date', 'slotId'],
  properties: {
    date: { type: 'string', pattern: DATE_PATTERN },
    slotId: { type: 'string', maxLength: 64 },
    text: { type: 'string', maxLength: 500 },
    link: { type: 'string', maxLength: 1024 },
    imageUrl: { type: 'string', maxLength: 1024 },
    cookId: { type: 'string', maxLength: 64 },
  },
  additionalProperties: false,
} as const;

const entryPatchBody = {
  type: 'object',
  minProperties: 1,
  properties: {
    date: { type: 'string', pattern: DATE_PATTERN },
    slotId: { type: 'string', maxLength: 64 },
    text: { type: 'string', maxLength: 500 },
    link: { type: 'string', maxLength: 1024 },
    imageUrl: { type: 'string', maxLength: 1024 },
    cookId: { type: 'string', maxLength: 64 },
  },
  additionalProperties: false,
} as const;

const rangeQuery = {
  type: 'object',
  required: ['from', 'to'],
  properties: {
    from: { type: 'string', pattern: DATE_PATTERN },
    to: { type: 'string', pattern: DATE_PATTERN },
  },
  additionalProperties: false,
} as const;

const slotParams = {
  type: 'object',
  required: ['slotId'],
  properties: { slotId: { type: 'string', maxLength: 64 } },
} as const;

const entryParams = {
  type: 'object',
  required: ['entryId'],
  properties: { entryId: { type: 'string', maxLength: 64 } },
} as const;

interface SlotInput {
  name: string;
}

interface SlotPatchInput {
  name?: string;
  sortOrder?: number;
}

interface EntryInput {
  date: string;
  slotId: string;
  text?: string;
  link?: string;
  imageUrl?: string;
  cookId?: string;
}

interface EntryPatchInput extends Partial<EntryInput> {}

interface RangeInput {
  from: string;
  to: string;
}

function requireAuthUser(reply: FastifyReply, authUser: AuthUser | undefined): AuthUser {
  if (authUser === undefined) {
    reply.code(401);
    throw new Error('missing auth user');
  }
  return authUser;
}

function isValidDate(value: string): boolean {
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().startsWith(value);
}

function isValidLink(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** '' clears an optional field; undefined leaves it untouched. */
function normalized(value: string | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function planRoutes(
  database: Database,
  guards: AuthGuards,
  hub: SyncHub,
): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    async function household(reply: FastifyReply, auth: AuthUser) {
      const result = await getHouseholdForMember(database, auth.id);
      if (result === undefined) {
        await reply.code(404).send({ error: 'not_found' });
      }
      return result;
    }

    app.get('/slots', async (request, reply) => {
      const auth = requireAuthUser(reply, request.authUser);
      const home = await household(reply, auth);
      if (home === undefined) return reply;
      return listMealSlots(database, home.id);
    });

    app.post<{ Body: SlotInput }>(
      '/slots',
      { schema: { body: slotBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const home = await household(reply, auth);
        if (home === undefined) return reply;
        const existing = await listMealSlots(database, home.id);
        const maxOrder = existing.reduce((max, slot) => Math.max(max, slot.sortOrder), 0);
        const slot = await createMealSlot(database, {
          householdId: home.id,
          name: request.body.name.trim(),
          sortOrder: maxOrder + 10,
        });
        hub.publish(planTopic(home.id), { type: 'slot.created', data: slot });
        return reply.code(201).send(slot);
      },
    );

    app.patch<{ Params: { slotId: string }; Body: SlotPatchInput }>(
      '/slots/:slotId',
      { schema: { params: slotParams, body: slotPatchBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const home = await household(reply, auth);
        const slot =
          home === undefined
            ? undefined
            : await getMealSlot(database, home.id, request.params.slotId);
        if (home === undefined || slot === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        const patch = {
          ...(request.body.name === undefined ? {} : { name: request.body.name.trim() }),
          ...(request.body.sortOrder === undefined ? {} : { sortOrder: request.body.sortOrder }),
        };
        await updateMealSlot(database, slot.id, patch);
        const updated = { ...slot, ...patch };
        hub.publish(planTopic(home.id), { type: 'slot.updated', data: updated });
        return updated;
      },
    );

    app.delete<{ Params: { slotId: string } }>(
      '/slots/:slotId',
      { schema: { params: slotParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const home = await household(reply, auth);
        const slot =
          home === undefined
            ? undefined
            : await getMealSlot(database, home.id, request.params.slotId);
        if (home === undefined || slot === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        await deleteMealSlot(database, slot.id);
        hub.publish(planTopic(home.id), { type: 'slot.deleted', data: { id: slot.id } });
        return reply.code(204).send();
      },
    );

    app.get<{ Querystring: RangeInput }>(
      '/entries',
      { schema: { querystring: rangeQuery } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const home = await household(reply, auth);
        if (home === undefined) return reply;
        const { from, to } = request.query;
        const spanDays =
          (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
        if (!isValidDate(from) || !isValidDate(to) || spanDays < 0 || spanDays > MAX_RANGE_DAYS) {
          return reply.code(400).send({ error: 'invalid_range' });
        }
        return listPlanEntries(database, home.id, from, to);
      },
    );

    /** Shared validation for create and move/edit; returns an error code or null. */
    async function validateEntryInput(
      householdId: string,
      input: {
        date?: string | undefined;
        slotId?: string | undefined;
        link?: string | null | undefined;
        imageUrl?: string | null | undefined;
        cookId?: string | null | undefined;
      },
    ): Promise<string | null> {
      if (input.date !== undefined && !isValidDate(input.date)) {
        return 'invalid_date';
      }
      if (input.slotId !== undefined) {
        const slot = await getMealSlot(database, householdId, input.slotId);
        if (slot === undefined) {
          return 'invalid_slot';
        }
      }
      if (typeof input.link === 'string' && !isValidLink(input.link)) {
        return 'invalid_link';
      }
      if (typeof input.imageUrl === 'string' && !isValidLink(input.imageUrl)) {
        return 'invalid_link';
      }
      if (
        typeof input.cookId === 'string' &&
        !(await isHouseholdMember(database, householdId, input.cookId))
      ) {
        return 'invalid_cook';
      }
      return null;
    }

    app.post<{ Body: EntryInput }>(
      '/entries',
      { schema: { body: entryBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const home = await household(reply, auth);
        if (home === undefined) return reply;

        const text = normalized(request.body.text) ?? null;
        const link = normalized(request.body.link) ?? null;
        const imageUrl = normalized(request.body.imageUrl) ?? null;
        const cookId = normalized(request.body.cookId) ?? null;
        if (text === null && link === null) {
          return reply.code(400).send({ error: 'text_or_link_required' });
        }
        const error = await validateEntryInput(home.id, {
          date: request.body.date,
          slotId: request.body.slotId,
          link,
          imageUrl,
          cookId,
        });
        if (error !== null) {
          return reply.code(400).send({ error });
        }
        const occupied = await findPlanEntryForSlot(
          database,
          home.id,
          request.body.date,
          request.body.slotId,
        );
        if (occupied !== undefined) {
          return reply.code(409).send({ error: 'slot_occupied' });
        }
        try {
          const entry = await createPlanEntry(database, {
            householdId: home.id,
            date: request.body.date,
            slotId: request.body.slotId,
            text,
            link,
            imageUrl,
            cookId,
          });
          hub.publish(planTopic(home.id), { type: 'plan.entry.created', data: entry });
          return reply.code(201).send(entry);
        } catch {
          // Unique(household, date, slot) race between check and insert.
          return reply.code(409).send({ error: 'slot_occupied' });
        }
      },
    );

    app.patch<{ Params: { entryId: string }; Body: EntryPatchInput }>(
      '/entries/:entryId',
      { schema: { params: entryParams, body: entryPatchBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const home = await household(reply, auth);
        const entry =
          home === undefined
            ? undefined
            : await getPlanEntry(database, home.id, request.params.entryId);
        if (home === undefined || entry === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }

        const text = normalized(request.body.text);
        const link = normalized(request.body.link);
        const imageUrl = normalized(request.body.imageUrl);
        const cookId = normalized(request.body.cookId);
        const error = await validateEntryInput(home.id, {
          date: request.body.date,
          slotId: request.body.slotId,
          link,
          imageUrl,
          cookId,
        });
        if (error !== null) {
          return reply.code(400).send({ error });
        }

        const patch = {
          ...(request.body.date === undefined ? {} : { date: request.body.date }),
          ...(request.body.slotId === undefined ? {} : { slotId: request.body.slotId }),
          ...(text === undefined ? {} : { text }),
          ...(link === undefined ? {} : { link }),
          ...(imageUrl === undefined ? {} : { imageUrl }),
          ...(cookId === undefined ? {} : { cookId }),
        };
        const next = { ...entry, ...patch };
        if (next.text === null && next.link === null) {
          return reply.code(400).send({ error: 'text_or_link_required' });
        }
        // Moving (W6): the target day/slot must be free, ignoring the entry itself.
        const occupied = await findPlanEntryForSlot(database, home.id, next.date, next.slotId);
        if (occupied !== undefined && occupied.id !== entry.id) {
          return reply.code(409).send({ error: 'slot_occupied' });
        }
        try {
          await updatePlanEntry(database, entry.id, patch);
        } catch {
          return reply.code(409).send({ error: 'slot_occupied' });
        }
        hub.publish(planTopic(home.id), { type: 'plan.entry.updated', data: next });
        return next;
      },
    );

    app.delete<{ Params: { entryId: string } }>(
      '/entries/:entryId',
      { schema: { params: entryParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const home = await household(reply, auth);
        const entry =
          home === undefined
            ? undefined
            : await getPlanEntry(database, home.id, request.params.entryId);
        if (home === undefined || entry === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        await deletePlanEntry(database, entry.id);
        hub.publish(planTopic(home.id), { type: 'plan.entry.deleted', data: { id: entry.id } });
        return reply.code(204).send();
      },
    );
  };
}

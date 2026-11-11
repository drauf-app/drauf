import { matchProvider, type ProviderContext, type RecipeProvider } from '@drauf/providers';
import { parseItemLine } from '@drauf/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import {
  createPlanEntry,
  findPlanEntryForSlot,
  getMealSlot,
  isCategoryLinkedToList,
} from '../db/repositories.js';
import type { PlanEntry } from '../db/schema/types.js';
import { getHouseholdForMember } from '../households/service.js';
import { FetchGuardError, fetchGuarded } from '../import/fetch.js';
import { addItemToList, type EntryView, getEntryView } from '../lists/items.js';
import { getListForMember } from '../lists/service.js';
import { listTopic, planTopic, type SyncHub } from '../sync/hub.js';

/**
 * Staple items deselected by default in the import preview (maintained per
 * household later); matching is on the parsed, lowercased name.
 */
const DEFAULT_STAPLES = new Set([
  'wasser',
  'salz',
  'pfeffer',
  'öl',
  'olivenöl',
  'zucker',
  'salz & pfeffer',
]);

const previewBody = {
  type: 'object',
  required: ['input'],
  properties: {
    input: { type: 'string', minLength: 1, maxLength: 4096 },
  },
  additionalProperties: false,
} as const;

const applyBody = {
  type: 'object',
  properties: {
    list: {
      type: 'object',
      required: ['id', 'items'],
      properties: {
        id: { type: 'string', maxLength: 64 },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string', minLength: 1, maxLength: 100 },
              quantity: { type: 'number', exclusiveMinimum: 0, maximum: 1_000_000 },
              unit: { type: 'string', maxLength: 32 },
              note: { type: 'string', maxLength: 500 },
              categoryId: { type: 'string', maxLength: 64 },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    plan: {
      type: 'object',
      required: ['date', 'slotId', 'link'],
      properties: {
        date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        slotId: { type: 'string', maxLength: 64 },
        title: { type: 'string', maxLength: 200 },
        link: { type: 'string', maxLength: 1024 },
        imageUrl: { type: 'string', maxLength: 1024 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const imageQuery = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, maxLength: 1024 },
  },
  additionalProperties: false,
} as const;

interface PreviewInput {
  input: string;
}

interface ApplyItem {
  name: string;
  quantity?: number;
  unit?: string;
  note?: string;
  categoryId?: string;
}

interface ApplyInput {
  list?: { id: string; items: ApplyItem[] };
  plan?: { date: string; slotId: string; title?: string; link: string; imageUrl?: string };
}

function requireAuthUser(reply: FastifyReply, authUser: AuthUser | undefined): AuthUser {
  if (authUser === undefined) {
    reply.code(401);
    throw new Error('missing auth user');
  }
  return authUser;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function importRoutes(
  database: Database,
  guards: AuthGuards,
  hub: SyncHub,
  providers: RecipeProvider[],
  context: ProviderContext,
): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    app.post<{ Body: PreviewInput }>(
      '/preview',
      {
        schema: { body: previewBody },
        config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        const match = matchProvider(providers, request.body.input);
        if (match === undefined) {
          return reply.code(422).send({ error: 'no_provider' });
        }
        try {
          const preview = await match.provider.fetch(match.url, context);
          return {
            provider: match.provider.id,
            url: match.url,
            title: preview.title,
            imageUrl: preview.imageUrl,
            servings: preview.servings,
            ingredients: preview.ingredients.map((raw) => {
              const parsed = parseItemLine(raw);
              return {
                raw,
                ...parsed,
                isStaple: DEFAULT_STAPLES.has(parsed.name.toLowerCase()),
              };
            }),
          };
        } catch (err) {
          request.log.warn({ err, provider: match.provider.id }, 'recipe preview failed');
          return reply.code(502).send({
            error: err instanceof FetchGuardError ? err.code : 'fetch_failed',
          });
        }
      },
    );

    app.post<{ Body: ApplyInput }>(
      '/apply',
      {
        schema: { body: applyBody },
        config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const { list: listInput, plan: planInput } = request.body;
        if (listInput === undefined && planInput === undefined) {
          return reply.code(400).send({ error: 'list_or_plan_required' });
        }

        // Validate everything before writing anything.
        if (listInput !== undefined) {
          const list = await getListForMember(database, listInput.id, auth.id);
          if (list === undefined) {
            return reply.code(404).send({ error: 'not_found' });
          }
          for (const item of listInput.items) {
            if (
              item.categoryId !== undefined &&
              !(await isCategoryLinkedToList(database, listInput.id, item.categoryId))
            ) {
              return reply.code(400).send({ error: 'invalid_category' });
            }
          }
        }
        let householdId: string | undefined;
        if (planInput !== undefined) {
          const household = await getHouseholdForMember(database, auth.id);
          if (household === undefined) {
            return reply.code(404).send({ error: 'not_found' });
          }
          householdId = household.id;
          if (!isHttpUrl(planInput.link)) {
            return reply.code(400).send({ error: 'invalid_link' });
          }
          if (planInput.imageUrl !== undefined && !isHttpUrl(planInput.imageUrl)) {
            return reply.code(400).send({ error: 'invalid_link' });
          }
          const slot = await getMealSlot(database, householdId, planInput.slotId);
          if (slot === undefined) {
            return reply.code(400).send({ error: 'invalid_slot' });
          }
          const occupied = await findPlanEntryForSlot(
            database,
            householdId,
            planInput.date,
            planInput.slotId,
          );
          if (occupied !== undefined) {
            return reply.code(409).send({ error: 'slot_occupied' });
          }
        }

        const entries: EntryView[] = [];
        if (listInput !== undefined) {
          for (const item of listInput.items) {
            const { entry, merged } = await addItemToList(
              database,
              listInput.id,
              auth.id,
              { ...item, categoryId: item.categoryId ?? null },
              'recipe',
            );
            const view = await getEntryView(database, entry);
            hub.publish(listTopic(listInput.id), {
              type: merged ? 'entry.updated' : 'entry.created',
              data: view,
            });
            entries.push(view);
          }
        }

        let planEntry: PlanEntry | undefined;
        if (planInput !== undefined && householdId !== undefined) {
          try {
            planEntry = await createPlanEntry(database, {
              householdId,
              date: planInput.date,
              slotId: planInput.slotId,
              text: planInput.title?.trim() || null,
              link: planInput.link,
              imageUrl: planInput.imageUrl ?? null,
              cookId: null,
            });
          } catch {
            return reply.code(409).send({ error: 'slot_occupied' });
          }
          hub.publish(planTopic(householdId), { type: 'plan.entry.created', data: planEntry });
        }

        return reply.code(201).send({ entries, ...(planEntry === undefined ? {} : { planEntry }) });
      },
    );

    /** Proxies recipe images so clients never contact third parties (W4). */
    app.get<{ Querystring: { url: string } }>(
      '/image',
      {
        schema: { querystring: imageQuery },
        config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        try {
          const result = await fetchGuarded(request.query.url, {
            timeoutMs: 10_000,
            maxBytes: 5 * 1024 * 1024,
            accept: 'image/*',
            allowedContentTypes: ['image/'],
          });
          return reply
            .header('cache-control', 'private, max-age=86400')
            .type(result.contentType)
            .send(result.body);
        } catch (err) {
          request.log.info({ err }, 'image proxy fetch failed');
          return reply.code(502).send({
            error: err instanceof FetchGuardError ? err.code : 'fetch_failed',
          });
        }
      },
    );
  };
}

import type { CatalogIndex } from '@drauf/catalog';
import { ICON_ID_MAX_LENGTH, isValidIconId, normalizeItemName } from '@drauf/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import {
  deleteCatalogUsage,
  listCatalogUsage,
  listCategories,
  parseVariants,
  patchCatalogUsage,
  renameCatalogUsage,
} from '../db/repositories.js';
import type { CatalogUsage } from '../db/schema/types.js';
import { getHouseholdForMember } from '../households/service.js';

const listQuery = {
  type: 'object',
  properties: {
    q: { type: 'string', maxLength: 64 },
    offset: { type: 'integer', minimum: 0 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    custom: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

interface ListInput {
  q?: string;
  offset?: number;
  limit?: number;
  custom?: boolean;
}

const itemParams = {
  type: 'object',
  required: ['nameNormalized'],
  properties: { nameNormalized: { type: 'string', minLength: 1, maxLength: 200 } },
  additionalProperties: false,
} as const;

const patchBody = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    categoryId: { type: ['string', 'null'], maxLength: 64 },
    /** '' clears the picked icon back to the catalogue match. */
    icon: { type: 'string', maxLength: ICON_ID_MAX_LENGTH },
    clearVariants: { type: 'boolean' },
    clearLastUsed: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

interface PatchInput {
  name?: string;
  categoryId?: string | null;
  icon?: string;
  clearVariants?: boolean;
  clearLastUsed?: boolean;
}

/** One learned/custom item as the admin editor sees it (#111). */
export interface AdminCatalogItem {
  name: string;
  nameNormalized: string;
  count: number;
  categoryId: string | null;
  /** Effective icon: the household's pick, else the catalogue match. */
  icon: string | null;
  variants: string[];
  /** True when the base catalogue does not know this name. */
  custom: boolean;
  updatedAt: string;
}

function toAdminItem(row: CatalogUsage, index: CatalogIndex): AdminCatalogItem {
  const catalogItem = index.byName.get(row.nameNormalized);
  return {
    name: row.name,
    nameNormalized: row.nameNormalized,
    count: row.count,
    categoryId: row.categoryId,
    icon: row.icon ?? catalogItem?.icon ?? null,
    variants: parseVariants(row.variants),
    custom: catalogItem === undefined,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Admin CRUD over the household's learned/custom items — session-only. */
export function catalogItemRoutes(
  database: Database,
  guards: AuthGuards,
  index: CatalogIndex,
): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);
    app.addHook('preHandler', guards.requireAdmin);

    async function householdOf(userId: string, reply: FastifyReply): Promise<string | undefined> {
      const household = await getHouseholdForMember(database, userId);
      if (household === undefined) {
        await reply.code(404).send({ error: 'not_found' });
        return undefined;
      }
      return household.id;
    }

    app.get<{ Querystring: ListInput }>(
      '/',
      { schema: { querystring: listQuery } },
      async (request, reply) => {
        const householdId = await householdOf(request.authUser?.id ?? '', reply);
        if (householdId === undefined) {
          return reply;
        }
        const needle = normalizeItemName(request.query.q ?? '');
        const items = (await listCatalogUsage(database, householdId))
          .map((row) => toAdminItem(row, index))
          .filter((item) => needle === '' || item.nameNormalized.includes(needle))
          .filter((item) => request.query.custom !== true || item.custom)
          .sort((a, b) => b.count - a.count || a.nameNormalized.localeCompare(b.nameNormalized));
        const offset = request.query.offset ?? 0;
        const limit = request.query.limit ?? 50;
        return { items: items.slice(offset, offset + limit), total: items.length };
      },
    );

    app.patch<{ Params: { nameNormalized: string }; Body: PatchInput }>(
      '/:nameNormalized',
      { schema: { params: itemParams, body: patchBody } },
      async (request, reply) => {
        const householdId = await householdOf(request.authUser?.id ?? '', reply);
        if (householdId === undefined) {
          return reply;
        }
        const { body } = request;

        if (typeof body.categoryId === 'string') {
          const known = (await listCategories(database, householdId)).some(
            (category) => category.id === body.categoryId,
          );
          if (!known) {
            return reply.code(400).send({ error: 'invalid_category' });
          }
        }
        if (body.icon !== undefined && body.icon !== '' && !isValidIconId(body.icon)) {
          return reply.code(400).send({ error: 'invalid_icon' });
        }
        const name = body.name?.trim();
        const nameNormalized = name === undefined ? undefined : normalizeItemName(name);
        if (name === '' || nameNormalized === '') {
          return reply.code(400).send({ error: 'invalid_name' });
        }

        let row = await patchCatalogUsage(database, householdId, request.params.nameNormalized, {
          categoryId: body.categoryId,
          icon: body.icon === undefined ? undefined : body.icon === '' ? null : body.icon,
          clearVariants: body.clearVariants,
          clearLastUsed: body.clearLastUsed,
        });
        if (row !== undefined && name !== undefined && nameNormalized !== undefined) {
          row = await renameCatalogUsage(database, householdId, request.params.nameNormalized, {
            name,
            nameNormalized,
          });
        }
        if (row === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        return toAdminItem(row, index);
      },
    );

    app.delete<{ Params: { nameNormalized: string } }>(
      '/:nameNormalized',
      { schema: { params: itemParams } },
      async (request, reply) => {
        const householdId = await householdOf(request.authUser?.id ?? '', reply);
        if (householdId === undefined) {
          return reply;
        }
        const deleted = await deleteCatalogUsage(
          database,
          householdId,
          request.params.nameNormalized,
        );
        if (!deleted) {
          return reply.code(404).send({ error: 'not_found' });
        }
        return reply.code(204).send();
      },
    );
  };
}

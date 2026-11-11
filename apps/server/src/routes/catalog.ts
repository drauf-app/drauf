import type { CatalogIndex } from '@drauf/catalog';
import { normalizeItemName } from '@drauf/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import { listCategories, searchCatalogUsage } from '../db/repositories.js';
import { getHouseholdForMember } from '../households/service.js';

const suggestQuery = {
  type: 'object',
  required: ['q'],
  properties: {
    q: { type: 'string', minLength: 1, maxLength: 64 },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
  },
  additionalProperties: false,
} as const;

interface SuggestInput {
  q: string;
  limit?: number;
}

/** One quick-add suggestion; history entries come first (K4). */
export interface Suggestion {
  name: string;
  source: 'history' | 'catalog';
  icon: string | null;
  categoryId: string | null;
  sizes: string[];
  varieties: string[];
  count?: number;
  lastQuantity?: number | null;
  lastUnit?: string | null;
  lastVariant?: string | null;
}

function requireAuthUser(reply: FastifyReply, authUser: AuthUser | undefined): AuthUser {
  if (authUser === undefined) {
    reply.code(401);
    throw new Error('missing auth user');
  }
  return authUser;
}

export function catalogRoutes(
  database: Database,
  guards: AuthGuards,
  index: CatalogIndex,
): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    app.get<{ Querystring: SuggestInput }>(
      '/suggest',
      { schema: { querystring: suggestQuery } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const household = await getHouseholdForMember(database, auth.id);
        if (household === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        const limit = request.query.limit ?? 10;
        const prefix = normalizeItemName(request.query.q);
        if (prefix === '') {
          return [];
        }

        const categoryIdByKey = new Map(
          (await listCategories(database, household.id))
            .filter((category) => category.key !== null)
            .map((category) => [category.key as string, category.id]),
        );
        const resolveKey = (key: string): string | null => categoryIdByKey.get(key) ?? null;

        const suggestions: Suggestion[] = [];
        const taken = new Set<string>();

        // Household history first (K4), enriched from the catalogue when known.
        for (const row of await searchCatalogUsage(database, household.id, prefix, limit)) {
          const catalogItem = index.byName.get(row.nameNormalized);
          taken.add(row.nameNormalized);
          suggestions.push({
            name: row.name,
            source: 'history',
            icon: catalogItem?.icon ?? null,
            categoryId:
              row.categoryId ??
              (catalogItem === undefined ? null : resolveKey(catalogItem.categoryKey)),
            sizes: catalogItem?.sizes ?? [],
            varieties: catalogItem?.varieties ?? [],
            count: row.count,
            lastQuantity: row.lastQuantity,
            lastUnit: row.lastUnit,
            lastVariant: row.lastVariant,
          });
        }

        for (const item of index.search(prefix, limit)) {
          if (suggestions.length >= limit) {
            break;
          }
          if (taken.has(normalizeItemName(item.name))) {
            continue;
          }
          suggestions.push({
            name: item.name,
            source: 'catalog',
            icon: item.icon,
            categoryId: resolveKey(item.categoryKey),
            sizes: item.sizes,
            varieties: item.varieties,
          });
        }

        return suggestions.slice(0, limit);
      },
    );
  };
}

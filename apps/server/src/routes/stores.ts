import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import {
  createStore,
  deleteStore,
  getStore,
  getStoreCategoryOrder,
  listCategories,
  listStores,
  replaceStoreCategoryOrder,
  updateStore,
} from '../db/repositories.js';
import { getHouseholdForMember } from '../households/service.js';

const nameBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
  },
  additionalProperties: false,
} as const;

const orderBody = {
  type: 'object',
  required: ['categoryIds'],
  properties: {
    categoryIds: {
      type: 'array',
      maxItems: 200,
      items: { type: 'string', maxLength: 64 },
    },
  },
  additionalProperties: false,
} as const;

const storeParams = {
  type: 'object',
  required: ['storeId'],
  properties: { storeId: { type: 'string', maxLength: 64 } },
} as const;

interface NameInput {
  name: string;
}

interface OrderInput {
  categoryIds: string[];
}

interface StoreParamsInput {
  storeId: string;
}

function requireAuthUser(reply: FastifyReply, authUser: AuthUser | undefined): AuthUser {
  if (authUser === undefined) {
    reply.code(401);
    throw new Error('missing auth user');
  }
  return authUser;
}

export function storeRoutes(database: Database, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    app.get('/', async (request, reply) => {
      const auth = requireAuthUser(reply, request.authUser);
      const household = await getHouseholdForMember(database, auth.id);
      if (household === undefined) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const stores = await listStores(database, household.id);
      return Promise.all(
        stores.map(async (store) => ({
          ...store,
          categoryOrder: await getStoreCategoryOrder(database, store.id),
        })),
      );
    });

    app.post<{ Body: NameInput }>('/', { schema: { body: nameBody } }, async (request, reply) => {
      const auth = requireAuthUser(reply, request.authUser);
      const household = await getHouseholdForMember(database, auth.id);
      if (household === undefined) {
        return reply.code(404).send({ error: 'not_found' });
      }
      const store = await createStore(database, {
        householdId: household.id,
        name: request.body.name.trim(),
      });
      return reply.code(201).send({ ...store, categoryOrder: [] });
    });

    app.patch<{ Params: StoreParamsInput; Body: NameInput }>(
      '/:storeId',
      { schema: { params: storeParams, body: nameBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const household = await getHouseholdForMember(database, auth.id);
        const store =
          household === undefined
            ? undefined
            : await getStore(database, household.id, request.params.storeId);
        if (household === undefined || store === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        const name = request.body.name.trim();
        await updateStore(database, store.id, { name });
        return { ...store, name, categoryOrder: await getStoreCategoryOrder(database, store.id) };
      },
    );

    app.delete<{ Params: StoreParamsInput }>(
      '/:storeId',
      { schema: { params: storeParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const household = await getHouseholdForMember(database, auth.id);
        const store =
          household === undefined
            ? undefined
            : await getStore(database, household.id, request.params.storeId);
        if (household === undefined || store === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        await deleteStore(database, store.id);
        return reply.code(204).send();
      },
    );

    app.put<{ Params: StoreParamsInput; Body: OrderInput }>(
      '/:storeId/category-order',
      { schema: { params: storeParams, body: orderBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const household = await getHouseholdForMember(database, auth.id);
        const store =
          household === undefined
            ? undefined
            : await getStore(database, household.id, request.params.storeId);
        if (household === undefined || store === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        // Every id must be a category of this household, without duplicates.
        const valid = new Set(
          (await listCategories(database, household.id)).map((category) => category.id),
        );
        const seen = new Set<string>();
        for (const categoryId of request.body.categoryIds) {
          if (!valid.has(categoryId) || seen.has(categoryId)) {
            return reply.code(400).send({ error: 'invalid_categories' });
          }
          seen.add(categoryId);
        }
        await replaceStoreCategoryOrder(database, store.id, request.body.categoryIds);
        return { ...store, categoryOrder: request.body.categoryIds };
      },
    );
  };
}

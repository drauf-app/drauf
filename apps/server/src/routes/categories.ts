import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  updateCategory,
} from '../db/repositories.js';
import { getHouseholdForMember } from '../households/service.js';

const createBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
  },
  additionalProperties: false,
} as const;

const patchBody = {
  type: 'object',
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    sortOrder: { type: 'integer', minimum: 0, maximum: 1_000_000 },
  },
  additionalProperties: false,
} as const;

const categoryParams = {
  type: 'object',
  required: ['categoryId'],
  properties: { categoryId: { type: 'string', maxLength: 64 } },
} as const;

interface CreateInput {
  name: string;
}

interface PatchInput {
  name?: string;
  sortOrder?: number;
}

interface CategoryParamsInput {
  categoryId: string;
}

function requireAuthUser(reply: FastifyReply, authUser: AuthUser | undefined): AuthUser {
  if (authUser === undefined) {
    reply.code(401);
    throw new Error('missing auth user');
  }
  return authUser;
}

export function categoryRoutes(database: Database, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    app.get('/', async (request, reply) => {
      const auth = requireAuthUser(reply, request.authUser);
      const household = await getHouseholdForMember(database, auth.id);
      if (household === undefined) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return listCategories(database, household.id);
    });

    app.post<{ Body: CreateInput }>(
      '/',
      { schema: { body: createBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const household = await getHouseholdForMember(database, auth.id);
        if (household === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        const existing = await listCategories(database, household.id);
        const maxOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), 0);
        const category = await createCategory(database, {
          householdId: household.id,
          key: null,
          name: request.body.name.trim(),
          sortOrder: maxOrder + 10,
        });
        return reply.code(201).send(category);
      },
    );

    app.patch<{ Params: CategoryParamsInput; Body: PatchInput }>(
      '/:categoryId',
      { schema: { params: categoryParams, body: patchBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const household = await getHouseholdForMember(database, auth.id);
        const category =
          household === undefined
            ? undefined
            : await getCategory(database, household.id, request.params.categoryId);
        if (household === undefined || category === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        const patch = {
          ...(request.body.name === undefined ? {} : { name: request.body.name.trim() }),
          ...(request.body.sortOrder === undefined ? {} : { sortOrder: request.body.sortOrder }),
        };
        await updateCategory(database, category.id, patch);
        return { ...category, ...patch };
      },
    );

    app.delete<{ Params: CategoryParamsInput }>(
      '/:categoryId',
      { schema: { params: categoryParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const household = await getHouseholdForMember(database, auth.id);
        const category =
          household === undefined
            ? undefined
            : await getCategory(database, household.id, request.params.categoryId);
        if (household === undefined || category === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (category.key !== null) {
          // The seeded base set is fixed (L5): renameable, never deletable.
          return reply.code(400).send({ error: 'base_category' });
        }
        await deleteCategory(database, category.id);
        return reply.code(204).send();
      },
    );
  };
}

import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import {
  addListMember,
  deleteList,
  getListById,
  getUserById,
  isUserInListHousehold,
  listListMemberUsers,
  listListsForUser,
  removeListMember,
  updateList,
} from '../db/repositories.js';
import { createListForUser, getListForMember } from '../lists/service.js';

const COLOR_PATTERN = '^#[0-9a-fA-F]{6}$';

const createBody = {
  type: 'object',
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    icon: { type: 'string', maxLength: 64 },
    color: { type: 'string', pattern: COLOR_PATTERN },
  },
  additionalProperties: false,
} as const;

const patchBody = {
  type: 'object',
  minProperties: 1,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 100 },
    icon: { type: 'string', maxLength: 64 },
    color: { type: 'string', pattern: COLOR_PATTERN },
    archived: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const listParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', maxLength: 64 } },
} as const;

const memberParams = {
  type: 'object',
  required: ['id', 'userId'],
  properties: {
    id: { type: 'string', maxLength: 64 },
    userId: { type: 'string', maxLength: 64 },
  },
} as const;

interface CreateInput {
  name: string;
  icon?: string;
  color?: string;
}

interface PatchInput {
  name?: string;
  icon?: string;
  color?: string;
  archived?: boolean;
}

interface ListParamsInput {
  id: string;
}

interface MemberParamsInput {
  id: string;
  userId: string;
}

function requireAuthUser(reply: FastifyReply, authUser: AuthUser | undefined): AuthUser {
  if (authUser === undefined) {
    // Unreachable behind the authenticate guard; satisfies the type system.
    reply.code(401);
    throw new Error('missing auth user');
  }
  return authUser;
}

export function listRoutes(database: Database, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    app.get('/', async (request, reply) => {
      const auth = requireAuthUser(reply, request.authUser);
      return listListsForUser(database, auth.id);
    });

    app.post<{ Body: CreateInput }>(
      '/',
      { schema: { body: createBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const list = await createListForUser(database, auth.id, request.body);
        return reply.code(201).send(list);
      },
    );

    app.get<{ Params: ListParamsInput }>(
      '/:id',
      { schema: { params: listParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const list = await getListForMember(database, request.params.id, auth.id);
        if (list === undefined) {
          // Non-members get the same answer as for unknown ids: no existence leak.
          return reply.code(404).send({ error: 'not_found' });
        }
        return { ...list, members: await listListMemberUsers(database, list.id) };
      },
    );

    app.patch<{ Params: ListParamsInput; Body: PatchInput }>(
      '/:id',
      { schema: { params: listParams, body: patchBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const list = await getListForMember(database, request.params.id, auth.id);
        if (list === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        await updateList(database, list.id, request.body);
        return getListById(database, list.id);
      },
    );

    app.delete<{ Params: ListParamsInput }>(
      '/:id',
      { schema: { params: listParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const list = await getListForMember(database, request.params.id, auth.id);
        if (list === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (list.ownerId !== auth.id) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        await deleteList(database, list.id);
        return reply.code(204).send();
      },
    );

    app.put<{ Params: MemberParamsInput }>(
      '/:id/members/:userId',
      { schema: { params: memberParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const list = await getListForMember(database, request.params.id, auth.id);
        if (list === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (list.ownerId !== auth.id) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        // The target id comes from the payload: verify it exists and belongs
        // to a household this list is attached to.
        const target = await getUserById(database, request.params.userId);
        if (target === undefined || !(await isUserInListHousehold(database, list.id, target.id))) {
          return reply.code(400).send({ error: 'invalid_user' });
        }
        await addListMember(database, list.id, target.id);
        return reply.code(204).send();
      },
    );

    app.delete<{ Params: MemberParamsInput }>(
      '/:id/members/:userId',
      { schema: { params: memberParams } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const list = await getListForMember(database, request.params.id, auth.id);
        if (list === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }
        if (list.ownerId !== auth.id) {
          return reply.code(403).send({ error: 'forbidden' });
        }
        if (request.params.userId === list.ownerId) {
          return reply.code(400).send({ error: 'cannot_remove_owner' });
        }
        await removeListMember(database, list.id, request.params.userId);
        return reply.code(204).send();
      },
    );
  };
}

import type { CatalogIndex } from '@drauf/catalog';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import {
  addListMember,
  deleteList,
  getListById,
  getUserById,
  isStoreLinkedToList,
  isUserInListHousehold,
  listListMemberUsers,
  listListsForUser,
  listOpenEntryNames,
  removeListMember,
  updateList,
} from '../db/repositories.js';
import { createListForUser, getListForMember } from '../lists/service.js';
import { listTopic, type SyncHub } from '../sync/hub.js';

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
    defaultStoreId: { type: ['string', 'null'], maxLength: 64 },
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
  defaultStoreId?: string | null;
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

const PREVIEW_ICONS = 4;

export function listRoutes(
  database: Database,
  guards: AuthGuards,
  hub: SyncHub,
  catalog: CatalogIndex,
): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    /** Overview rows carry what is on each list: open count + icon preview. */
    app.get('/', async (request, reply) => {
      const auth = requireAuthUser(reply, request.authUser);
      const lists = await listListsForUser(database, auth.id);
      const open = await listOpenEntryNames(
        database,
        lists.map((list) => list.id),
      );
      return lists.map((list) => {
        const names = open.filter((entry) => entry.listId === list.id);
        const previewIcons: string[] = [];
        for (const entry of names) {
          const icon = catalog.match(entry.name)?.icon;
          if (icon !== undefined && previewIcons.length < PREVIEW_ICONS) {
            previewIcons.push(icon);
          }
        }
        return { ...list, openCount: names.length, previewIcons };
      });
    });

    app.post<{ Body: CreateInput }>(
      '/',
      { schema: { body: createBody } },
      async (request, reply) => {
        const auth = requireAuthUser(reply, request.authUser);
        const list = await createListForUser(database, auth.id, request.body);
        return reply.code(201).send({ ...list, openCount: 0, previewIcons: [] });
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
        // The store id comes from the payload: it must belong to a household
        // this list is attached to (L7 default store per list).
        const { defaultStoreId } = request.body;
        if (
          typeof defaultStoreId === 'string' &&
          !(await isStoreLinkedToList(database, list.id, defaultStoreId))
        ) {
          return reply.code(400).send({ error: 'invalid_store' });
        }
        await updateList(database, list.id, request.body);
        const updated = await getListById(database, list.id);
        hub.publish(listTopic(list.id), { type: 'list.updated', data: updated });
        return updated;
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
        hub.publish(listTopic(list.id), { type: 'list.deleted', data: { id: list.id } });
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
        hub.publish(listTopic(list.id), { type: 'member.added', data: { userId: target.id } });
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
        const topic = listTopic(list.id);
        hub.publish(topic, { type: 'member.removed', data: { userId: request.params.userId } });
        // Removed members must stop receiving this list's events immediately.
        hub.evict(topic, request.params.userId);
        return reply.code(204).send();
      },
    );
  };
}

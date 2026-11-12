import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import { listHouseholdMemberUsers } from '../db/repositories.js';
import { getHouseholdForMember } from '../households/service.js';

export function householdRoutes(database: Database, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    /** The caller's household with its members, e.g. for the "who cooks" picker. */
    app.get('/me', async (request, reply) => {
      const userId = request.authUser?.id ?? '';
      const household = await getHouseholdForMember(database, userId);
      if (household === undefined) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return {
        id: household.id,
        name: household.name,
        members: await listHouseholdMemberUsers(database, household.id),
      };
    });
  };
}

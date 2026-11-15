import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import { listHouseholdMemberUsers, updateHouseholdStaples } from '../db/repositories.js';
import type { Household } from '../db/schema/types.js';
import { buildHouseholdExport } from '../households/export.js';
import { getHouseholdForMember } from '../households/service.js';
import { effectiveStaples, normalizeStaples } from '../households/staples.js';

interface StaplesInput {
  staples: string[];
}

const staplesBody = {
  type: 'object',
  required: ['staples'],
  properties: {
    staples: {
      type: 'array',
      maxItems: 200,
      items: { type: 'string', minLength: 1, maxLength: 100 },
    },
  },
  additionalProperties: false,
} as const;

function staplesView(household: Household): { staples: string[]; custom: boolean } {
  return { staples: effectiveStaples(household), custom: household.staples !== null };
}

export function householdRoutes(database: Database, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    async function resolve(reply: FastifyReply, userId: string): Promise<Household | undefined> {
      const household = await getHouseholdForMember(database, userId);
      if (household === undefined) {
        await reply.code(404).send({ error: 'not_found' });
      }
      return household;
    }

    /** The caller's household with its members, e.g. for the "who cooks" picker. */
    app.get('/me', async (request, reply) => {
      const household = await resolve(reply, request.authUser?.id ?? '');
      if (household === undefined) return reply;
      return {
        id: household.id,
        name: household.name,
        members: await listHouseholdMemberUsers(database, household.id),
      };
    });

    /**
     * The backup document (JSON export per household). Any member may pull
     * it: everything in it is already visible to members through the
     * regular APIs, and backups should not depend on an admin being around.
     */
    app.get('/me/export', async (request, reply) => {
      const household = await resolve(reply, request.authUser?.id ?? '');
      if (household === undefined) return reply;
      const document = await buildHouseholdExport(database, household);
      reply.header(
        'content-disposition',
        `attachment; filename="drauf-export-${document.exportedAt.slice(0, 10)}.json"`,
      );
      return document;
    });

    /** Staples are deselected by default in the recipe import preview. */
    app.get('/staples', async (request, reply) => {
      const household = await resolve(reply, request.authUser?.id ?? '');
      if (household === undefined) return reply;
      return staplesView(household);
    });

    app.put<{ Body: StaplesInput }>(
      '/staples',
      { schema: { body: staplesBody } },
      async (request, reply) => {
        const household = await resolve(reply, request.authUser?.id ?? '');
        if (household === undefined) return reply;
        const staples = normalizeStaples(request.body.staples);
        await updateHouseholdStaples(database, household.id, staples);
        return staplesView({ ...household, staples: JSON.stringify(staples) });
      },
    );

    /** Removing the household's own list restores the default staples. */
    app.delete('/staples', async (request, reply) => {
      const household = await resolve(reply, request.authUser?.id ?? '');
      if (household === undefined) return reply;
      await updateHouseholdStaples(database, household.id, null);
      return staplesView({ ...household, staples: null });
    });
  };
}

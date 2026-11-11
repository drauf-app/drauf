import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import { login, logout, refresh } from '../auth/service.js';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { getUserById } from '../db/repositories.js';
import { toPublicUser } from '../users/service.js';

const credentialsBody = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', maxLength: 128 },
    password: { type: 'string', maxLength: 1024 },
    deviceName: { type: 'string', maxLength: 128 },
  },
  additionalProperties: false,
} as const;

const refreshBody = {
  type: 'object',
  required: ['refreshToken'],
  properties: {
    refreshToken: { type: 'string', maxLength: 1024 },
  },
  additionalProperties: false,
} as const;

interface CredentialsInput {
  username: string;
  password: string;
  deviceName?: string;
}

interface RefreshInput {
  refreshToken: string;
}

export function authRoutes(
  database: Database,
  config: Config,
  guards: AuthGuards,
): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: CredentialsInput }>(
      '/login',
      {
        schema: { body: credentialsBody },
        config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        if (!config.localLoginEnabled) {
          return reply.code(403).send({ error: 'local_login_disabled' });
        }
        const result = await login(database, config.authSecret, request.body);
        if (!result.ok) {
          return reply.code(result.reason === 'account_locked' ? 403 : 401).send({
            error: result.reason,
          });
        }
        return {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          user: toPublicUser(result.user),
        };
      },
    );

    app.post<{ Body: RefreshInput }>(
      '/refresh',
      {
        schema: { body: refreshBody },
        config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        const pair = await refresh(database, config.authSecret, request.body.refreshToken);
        if (pair === undefined) {
          return reply.code(401).send({ error: 'invalid_refresh_token' });
        }
        return pair;
      },
    );

    app.post<{ Body: RefreshInput }>(
      '/logout',
      { schema: { body: refreshBody } },
      async (request, reply) => {
        await logout(database, request.body.refreshToken);
        return reply.code(204).send();
      },
    );

    /** Which sign-in methods this instance offers; public, for login screens. */
    app.get('/providers', async () => ({
      localLogin: config.localLoginEnabled,
      oidc: config.oidc !== undefined,
    }));

    app.get('/me', { preHandler: [guards.authenticate] }, async (request, reply) => {
      // authenticate always sets authUser; fresh lookup so profile changes are visible.
      const userId = request.authUser?.id ?? '';
      const user = await getUserById(database, userId);
      if (user === undefined) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      return toPublicUser(user);
    });
  };
}

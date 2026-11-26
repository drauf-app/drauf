import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import { hashPassword, MIN_PASSWORD_LENGTH, verifyPassword } from '../auth/passwords.js';
import { login, logout, refresh } from '../auth/service.js';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { getUserById, updateUserDisplayName, updateUserPassword } from '../db/repositories.js';
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

const profileBody = {
  type: 'object',
  required: ['displayName'],
  properties: {
    displayName: { type: 'string', maxLength: 128 },
  },
  additionalProperties: false,
} as const;

interface ProfileInput {
  displayName: string;
}

const passwordBody = {
  type: 'object',
  required: ['currentPassword', 'newPassword'],
  properties: {
    currentPassword: { type: 'string', maxLength: 1024 },
    newPassword: { type: 'string', maxLength: 1024 },
  },
  additionalProperties: false,
} as const;

interface PasswordInput {
  currentPassword: string;
  newPassword: string;
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

    /** Profile edits (#98). The display name is only seeded from the IdP once. */
    app.patch<{ Body: ProfileInput }>(
      '/me',
      { preHandler: [guards.authenticate], schema: { body: profileBody } },
      async (request, reply) => {
        const userId = request.authUser?.id ?? '';
        const user = await getUserById(database, userId);
        if (user === undefined) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        const displayName = request.body.displayName.trim();
        if (displayName.length === 0) {
          return reply.code(400).send({ error: 'invalid_display_name' });
        }
        await updateUserDisplayName(database, userId, displayName);
        return toPublicUser({ ...user, displayName });
      },
    );

    /** Own-password change for local accounts (#98); admins set initial ones. */
    app.put<{ Body: PasswordInput }>(
      '/password',
      {
        preHandler: [guards.authenticate],
        schema: { body: passwordBody },
        config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        const userId = request.authUser?.id ?? '';
        const user = await getUserById(database, userId);
        if (user === undefined) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        if (user.passwordHash === null) {
          return reply.code(400).send({ error: 'no_local_password' });
        }
        if (!(await verifyPassword(user.passwordHash, request.body.currentPassword))) {
          return reply.code(403).send({ error: 'invalid_password' });
        }
        if (request.body.newPassword.length < MIN_PASSWORD_LENGTH) {
          return reply.code(400).send({ error: 'password_too_short' });
        }
        await updateUserPassword(database, userId, await hashPassword(request.body.newPassword));
        return reply.code(204).send();
      },
    );
  };
}

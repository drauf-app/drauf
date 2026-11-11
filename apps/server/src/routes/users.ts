import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import { listUsers } from '../db/repositories.js';
import { createLocalUser, toPublicUser } from '../users/service.js';

const createUserBody = {
  type: 'object',
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', maxLength: 128 },
    password: { type: 'string', maxLength: 1024 },
    displayName: { type: 'string', minLength: 1, maxLength: 128 },
    isAdmin: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

interface CreateUserInput {
  username: string;
  password: string;
  displayName?: string;
  isAdmin?: boolean;
}

export function userRoutes(database: Database, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    const adminOnly = [guards.authenticate, guards.requireAdmin];

    app.post<{ Body: CreateUserInput }>(
      '/',
      { preHandler: adminOnly, schema: { body: createUserBody } },
      async (request, reply) => {
        const result = await createLocalUser(database, {
          username: request.body.username,
          password: request.body.password,
          displayName: request.body.displayName ?? request.body.username,
          isAdmin: request.body.isAdmin ?? false,
        });
        if (!result.ok) {
          return reply.code(result.reason === 'username_taken' ? 409 : 400).send({
            error: result.reason,
          });
        }
        return reply.code(201).send(toPublicUser(result.user));
      },
    );

    app.get('/', { preHandler: adminOnly }, async () => {
      const users = await listUsers(database);
      return users.map(toPublicUser);
    });
  };
}

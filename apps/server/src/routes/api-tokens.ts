import { API_TOKEN_NAME_MAX_LENGTH, type ApiTokenScope, isApiTokenScope } from '@drauf/shared';
import type { FastifyPluginAsync } from 'fastify';
import { generateApiToken, hashApiToken } from '../auth/api-tokens.js';
import type { AuthGuards } from '../auth/guard.js';
import type { Database } from '../db/index.js';
import { createApiToken, deleteApiToken, listApiTokensByUser } from '../db/repositories.js';
import type { ApiToken } from '../db/schema/types.js';

const createBody = {
  type: 'object',
  required: ['name', 'scopes'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: API_TOKEN_NAME_MAX_LENGTH },
    scopes: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: { type: 'string', maxLength: 32 },
    },
  },
  additionalProperties: false,
} as const;

interface CreateInput {
  name: string;
  scopes: string[];
}

interface PublicApiToken {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
}

function toPublicToken(token: ApiToken): PublicApiToken {
  const parsed: unknown = JSON.parse(token.scopes);
  const scopes = Array.isArray(parsed) ? parsed.filter(isApiTokenScope) : [];
  return {
    id: token.id,
    name: token.name,
    scopes,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
  };
}

/**
 * Per-user API token management (#97). Guarded by `authenticate`, which
 * refuses API tokens by design: a leaked token must not be able to mint or
 * revoke tokens.
 */
export function apiTokenRoutes(database: Database, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);

    app.get('/', async (request) => {
      const tokens = await listApiTokensByUser(database, request.authUser?.id ?? '');
      return tokens.map(toPublicToken);
    });

    app.post<{ Body: CreateInput }>(
      '/',
      {
        schema: { body: createBody },
        config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        const name = request.body.name.trim();
        if (name.length === 0) {
          return reply.code(400).send({ error: 'invalid_name' });
        }
        const scopes = [...new Set(request.body.scopes)];
        if (!scopes.every(isApiTokenScope)) {
          return reply.code(400).send({ error: 'invalid_scope' });
        }
        const token = generateApiToken();
        const row = await createApiToken(database, {
          userId: request.authUser?.id ?? '',
          name,
          tokenHash: hashApiToken(token),
          scopes: JSON.stringify(scopes),
        });
        // The plaintext token exists in this response only; we store the hash.
        return reply.code(201).send({ ...toPublicToken(row), token });
      },
    );

    app.delete<{ Params: { id: string } }>('/:id', async (request, reply) => {
      const deleted = await deleteApiToken(database, request.authUser?.id ?? '', request.params.id);
      if (!deleted) {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.code(204).send();
    });
  };
}

import type { FastifyPluginAsync } from 'fastify';
import type { WebSocket } from 'ws';
import type { AuthGuards, AuthUser } from '../auth/guard.js';
import { verifyAccessToken } from '../auth/tokens.js';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { getHouseholdForMember } from '../households/service.js';
import { getListForMember } from '../lists/service.js';
import { listTopic, planTopic, type SyncHub } from '../sync/hub.js';
import { applyOperations, OPERATION_TYPES, type SyncOperation } from '../sync/operations.js';

const AUTH_DEADLINE_MS = 10_000;
const MAX_SUBSCRIPTIONS = 50;

const operationsBody = {
  type: 'object',
  required: ['operations'],
  properties: {
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: {
        type: 'object',
        required: ['id', 'type', 'time', 'data'],
        properties: {
          id: { type: 'string', minLength: 8, maxLength: 64 },
          type: { type: 'string', enum: [...OPERATION_TYPES] },
          time: { type: 'string', maxLength: 40 },
          data: { type: 'object' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

interface OperationsInput {
  operations: SyncOperation[];
}

function send(socket: WebSocket, message: object): void {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

export function syncRoutes(
  database: Database,
  config: Config,
  guards: AuthGuards,
  hub: SyncHub,
): FastifyPluginAsync {
  return async (app) => {
    app.post<{ Body: OperationsInput }>(
      '/operations',
      { preHandler: [guards.authenticate], schema: { body: operationsBody } },
      async (request, reply) => {
        const auth = request.authUser;
        if (auth === undefined) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        const results = await applyOperations(database, hub, auth.id, request.body.operations);
        return { results };
      },
    );

    app.get('/socket', { websocket: true }, (socket, request) => {
      let user: AuthUser | undefined;
      // First-message auth: the token never appears in URLs or request logs.
      const deadline = setTimeout(() => socket.close(4401, 'auth timeout'), AUTH_DEADLINE_MS);

      socket.on('close', () => {
        clearTimeout(deadline);
        hub.unsubscribeAll(socket);
      });

      socket.on('message', (raw) => {
        void (async () => {
          let message: { type?: unknown; token?: unknown; lists?: unknown; plan?: unknown };
          try {
            message = JSON.parse(String(raw));
          } catch {
            send(socket, { type: 'error', error: 'invalid_message' });
            return;
          }

          if (user === undefined) {
            if (message.type !== 'auth' || typeof message.token !== 'string') {
              socket.close(4401, 'authentication required');
              return;
            }
            const claims = await verifyAccessToken(config.authSecret, message.token);
            if (claims === undefined) {
              socket.close(4401, 'invalid token');
              return;
            }
            clearTimeout(deadline);
            user = { id: claims.userId, isAdmin: claims.isAdmin };
            send(socket, { type: 'auth_ok' });
            return;
          }

          switch (message.type) {
            case 'subscribe': {
              const topics: string[] = [];
              const listIds = Array.isArray(message.lists) ? message.lists : [];
              for (const listId of listIds.slice(0, MAX_SUBSCRIPTIONS)) {
                if (typeof listId !== 'string') {
                  continue;
                }
                // Membership decides visibility; unknown ids are silently skipped
                // so subscribers cannot probe for list existence.
                const list = await getListForMember(database, listId, user.id);
                if (list !== undefined) {
                  const topic = listTopic(list.id);
                  hub.subscribe(topic, socket, user.id);
                  topics.push(topic);
                }
              }
              if (message.plan === true) {
                const household = await getHouseholdForMember(database, user.id);
                if (household !== undefined) {
                  const topic = planTopic(household.id);
                  hub.subscribe(topic, socket, user.id);
                  topics.push(topic);
                }
              }
              send(socket, { type: 'subscribed', topics });
              return;
            }
            case 'ping':
              send(socket, { type: 'pong' });
              return;
            default:
              send(socket, { type: 'error', error: 'unknown_message' });
              return;
          }
        })().catch((err) => {
          request.log.warn({ err }, 'websocket message handling failed');
          send(socket, { type: 'error', error: 'internal_error' });
        });
      });
    });
  };
}

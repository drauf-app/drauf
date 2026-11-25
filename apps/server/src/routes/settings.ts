import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import { SettingError, type SettingsService, type SettingValue } from '../settings/service.js';

interface PutInput {
  key: string;
  value: SettingValue;
}

const putBody = {
  type: 'object',
  required: ['key', 'value'],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 100 },
    value: { type: ['boolean', 'string'] },
  },
  additionalProperties: false,
} as const;

/** Admin-managed runtime settings (#73); secrets stay environment-only. */
export function settingsRoutes(settings: SettingsService, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.addHook('preHandler', guards.authenticate);
    app.addHook('preHandler', guards.requireAdmin);

    app.get('/', async () => ({ settings: await settings.list() }));

    app.put<{ Body: PutInput }>('/', { schema: { body: putBody } }, async (request, reply) => {
      try {
        return await settings.set(request.body.key, request.body.value);
      } catch (err) {
        if (err instanceof SettingError) {
          return reply.code(err.code === 'unknown_setting' ? 404 : 400).send({ error: err.code });
        }
        throw err;
      }
    });
  };
}

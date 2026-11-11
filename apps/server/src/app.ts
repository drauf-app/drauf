import type { HealthResponse } from '@drauf/shared';
import { type FastifyInstance, fastify } from 'fastify';
import type { Config } from './config.js';

export function buildApp(config: Config): FastifyInstance {
  const app = fastify({
    logger: {
      level: config.logLevel,
      // Secrets must never end up in logs; request bodies are not logged at all.
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        censor: '[redacted]',
      },
    },
  });

  app.get('/healthz', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  return app;
}

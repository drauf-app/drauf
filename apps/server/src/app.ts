import type { HealthResponse } from '@drauf/shared';
import rateLimit from '@fastify/rate-limit';
import { type FastifyInstance, fastify } from 'fastify';
import { createAuthGuards } from './auth/guard.js';
import { createOidcService } from './auth/oidc.js';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { listRoutes } from './routes/lists.js';
import { oidcRoutes } from './routes/oidc.js';
import { userRoutes } from './routes/users.js';

export async function buildApp(config: Config, database: Database): Promise<FastifyInstance> {
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

  // Registered without global rules; routes opt in via their config.rateLimit.
  await app.register(rateLimit, { global: false });

  const guards = createAuthGuards(config.authSecret);

  app.get('/healthz', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  const oidcService =
    config.oidc !== undefined && config.publicUrl !== undefined
      ? createOidcService(config.oidc, config.publicUrl)
      : undefined;

  await app.register(authRoutes(database, config, guards), { prefix: '/api/auth' });
  await app.register(oidcRoutes(database, config, oidcService), { prefix: '/api/auth/oidc' });
  await app.register(userRoutes(database, guards), { prefix: '/api/users' });
  await app.register(listRoutes(database, guards), { prefix: '/api/lists' });

  return app;
}

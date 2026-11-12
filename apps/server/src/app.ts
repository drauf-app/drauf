import { buildCatalogIndex, type CatalogItem, loadCatalog } from '@drauf/catalog';
import { allProviders, type ProviderContext, type RecipeProvider } from '@drauf/providers';
import type { HealthResponse } from '@drauf/shared';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { type FastifyInstance, fastify } from 'fastify';
import { createAuthGuards } from './auth/guard.js';
import { createOidcService } from './auth/oidc.js';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import { fetchGuarded } from './import/fetch.js';
import { authRoutes } from './routes/auth.js';
import { catalogRoutes } from './routes/catalog.js';
import { categoryRoutes } from './routes/categories.js';
import { entryRoutes } from './routes/entries.js';
import { householdRoutes } from './routes/households.js';
import { importRoutes } from './routes/import.js';
import { listRoutes } from './routes/lists.js';
import { oidcRoutes } from './routes/oidc.js';
import { planRoutes } from './routes/plan.js';
import { storeRoutes } from './routes/stores.js';
import { syncRoutes } from './routes/sync.js';
import { userRoutes } from './routes/users.js';
import { SyncHub } from './sync/hub.js';
import { registerWebApp } from './web.js';

export interface BuildAppOptions {
  /** Test seam: replaces the built-in recipe providers. */
  providers?: RecipeProvider[];
  /** Test seam: replaces the base item catalogue. */
  catalog?: CatalogItem[];
  /** Test seam: replaces the SSRF-guarded page fetcher handed to providers. */
  providerContext?: ProviderContext;
}

export async function buildApp(
  config: Config,
  database: Database,
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
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
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  const guards = createAuthGuards(config.authSecret);
  const hub = new SyncHub();

  app.get('/healthz', async (): Promise<HealthResponse> => ({ status: 'ok' }));

  const oidcService =
    config.oidc !== undefined && config.publicUrl !== undefined
      ? createOidcService(config.oidc, config.publicUrl)
      : undefined;

  await app.register(authRoutes(database, config, guards), { prefix: '/api/auth' });
  await app.register(oidcRoutes(database, config, oidcService), { prefix: '/api/auth/oidc' });
  await app.register(userRoutes(database, guards), { prefix: '/api/users' });
  await app.register(householdRoutes(database, guards), { prefix: '/api/households' });
  await app.register(listRoutes(database, guards, hub), { prefix: '/api/lists' });
  await app.register(entryRoutes(database, guards, hub), { prefix: '/api/lists' });
  await app.register(categoryRoutes(database, guards), { prefix: '/api/categories' });
  await app.register(storeRoutes(database, guards), { prefix: '/api/stores' });
  await app.register(planRoutes(database, guards, hub), { prefix: '/api/plan' });
  const catalogIndex = buildCatalogIndex(options.catalog ?? loadCatalog());
  await app.register(catalogRoutes(database, guards, catalogIndex), { prefix: '/api/catalog' });
  await app.register(syncRoutes(database, config, guards, hub), { prefix: '/api/sync' });

  const providers = (options.providers ?? allProviders).filter(
    (provider) => !config.disabledProviders.includes(provider.id),
  );
  const providerContext: ProviderContext = options.providerContext ?? {
    fetchText: async (url) => {
      const result = await fetchGuarded(url, {
        timeoutMs: 10_000,
        maxBytes: 2 * 1024 * 1024,
        accept: 'text/html,application/xhtml+xml',
        allowedContentTypes: ['text/html', 'application/xhtml+xml'],
      });
      return result.body.toString('utf8');
    },
  };
  await app.register(importRoutes(database, guards, hub, providers, providerContext), {
    prefix: '/api/import',
  });

  if (await registerWebApp(app, config.webDir)) {
    app.log.info({ webDir: config.webDir }, 'serving the web app');
  }

  return app;
}

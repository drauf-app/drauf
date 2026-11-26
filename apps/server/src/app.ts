import { buildCatalogIndex, type CatalogItem, loadCatalog } from '@drauf/catalog';
import { allProviders, type ProviderContext, type RecipeProvider } from '@drauf/providers';
import type { HealthResponse } from '@drauf/shared';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { type FastifyInstance, fastify } from 'fastify';
import { createAuthGuards } from './auth/guard.js';
import { createOidcService } from './auth/oidc.js';
import { createAvatarService } from './avatars/service.js';
import { type Categorizer, createCategorizer } from './categorize/index.js';
import { createCategorizeService } from './categorize/service.js';
import type { Config } from './config.js';
import type { Database } from './db/index.js';
import { createIconsService } from './icons/service.js';
import { fetchGuarded } from './import/fetch.js';
import { apiTokenRoutes } from './routes/api-tokens.js';
import { authRoutes } from './routes/auth.js';
import { avatarRoutes } from './routes/avatars.js';
import { catalogRoutes } from './routes/catalog.js';
import { catalogItemRoutes } from './routes/catalog-items.js';
import { categoryRoutes } from './routes/categories.js';
import { entryRoutes } from './routes/entries.js';
import { householdRoutes } from './routes/households.js';
import { iconRoutes } from './routes/icons.js';
import { importRoutes } from './routes/import.js';
import { listRoutes } from './routes/lists.js';
import { oidcRoutes } from './routes/oidc.js';
import { planRoutes } from './routes/plan.js';
import { settingsRoutes } from './routes/settings.js';
import { storeRoutes } from './routes/stores.js';
import { syncRoutes } from './routes/sync.js';
import { userRoutes } from './routes/users.js';
import { buildSettingDefinitions, createSettingsService } from './settings/service.js';
import { SyncHub } from './sync/hub.js';
import { createUpdateChecker, type UpdateChecker } from './version/update-check.js';
import { registerWebApp } from './web.js';

export interface BuildAppOptions {
  /** Test seam: replaces the built-in recipe providers. */
  providers?: RecipeProvider[];
  /** Test seam: replaces the base item catalogue. */
  catalog?: CatalogItem[];
  /** Test seam: replaces the SSRF-guarded page fetcher handed to providers. */
  providerContext?: ProviderContext;
  /** Test seam: injects an LLM categorizer without network or config. */
  categorizer?: Categorizer;
  /** Test seam: replaces the GitHub release lookup. */
  updateChecker?: UpdateChecker;
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

  const guards = createAuthGuards(config.authSecret, database);
  const hub = new SyncHub();

  app.get('/healthz', async (): Promise<HealthResponse> => ({ status: 'ok' }));
  // Which build is running (#74): public like the health check; the values
  // say nothing the public repository does not.
  app.get('/api/version', async () => ({ version: config.version, commit: config.commit ?? null }));

  const oidcService =
    config.oidc !== undefined && config.publicUrl !== undefined
      ? createOidcService(
          config.oidc,
          config.publicUrl,
          createAvatarService(config.avatarsDir, config.oidc.issuer, app.log),
        )
      : undefined;

  const catalogIndex = buildCatalogIndex(options.catalog ?? loadCatalog());
  // The full provider list stays registered; env-disabled ones surface as
  // locked-off settings and the routes gate at request time (#73).
  const providers = options.providers ?? allProviders;
  const settings = createSettingsService(database, buildSettingDefinitions(config, providers));
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

  const categorizer =
    options.categorizer ??
    createCategorizer(config.categorize, async () =>
      String(await settings.effective('categorize.model')),
    );
  const categorize =
    categorizer === undefined
      ? undefined
      : createCategorizeService({
          database,
          hub,
          categorizer,
          catalog: catalogIndex,
          log: app.log,
          enabled: async () => (await settings.effective('categorize.enabled')) === true,
        });

  await app.register(authRoutes(database, config, guards), { prefix: '/api/auth' });
  await app.register(apiTokenRoutes(database, guards), { prefix: '/api/auth/tokens' });
  await app.register(oidcRoutes(database, config, oidcService), { prefix: '/api/auth/oidc' });
  await app.register(userRoutes(database, guards), { prefix: '/api/users' });
  await app.register(householdRoutes(database, guards), { prefix: '/api/households' });
  await app.register(listRoutes(database, guards, hub, catalogIndex), { prefix: '/api/lists' });
  await app.register(entryRoutes(database, guards, hub, catalogIndex, categorize), {
    prefix: '/api/lists',
  });
  await app.register(categoryRoutes(database, guards), { prefix: '/api/categories' });
  await app.register(storeRoutes(database, guards), { prefix: '/api/stores' });
  await app.register(planRoutes(database, guards, hub, providers, providerContext, settings), {
    prefix: '/api/plan',
  });
  const updateChecker =
    options.updateChecker ?? createUpdateChecker({ currentVersion: config.version });
  await app.register(settingsRoutes(settings, guards, updateChecker), {
    prefix: '/api/admin/settings',
  });
  await app.register(catalogRoutes(database, guards, catalogIndex), { prefix: '/api/catalog' });
  // Admin cleanup of learned/custom items — session-only, no token scope (#111).
  await app.register(catalogItemRoutes(database, guards, catalogIndex), {
    prefix: '/api/catalog/items',
  });
  // Absolute paths (/api/icons + /icons/custom/*): the files must live
  // outside /api/ so the service worker caches them for offline (#71).
  await app.register(iconRoutes(createIconsService(config.iconsDir, app.log), guards, settings));
  // Absolute path /avatars/:key — outside /api/ for the same offline reason.
  await app.register(avatarRoutes(database, config.avatarsDir));
  await app.register(syncRoutes(database, config, guards, hub, catalogIndex, categorize), {
    prefix: '/api/sync',
  });

  await app.register(
    importRoutes(
      database,
      guards,
      hub,
      providers,
      providerContext,
      catalogIndex,
      categorize,
      settings,
    ),
    {
      prefix: '/api/import',
    },
  );

  if (await registerWebApp(app, config.webDir)) {
    app.log.info({ webDir: config.webDir }, 'serving the web app');
  }

  return app;
}

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import { createRasterizer, DEFAULT_RASTER_SIZE, RASTER_SIZES } from '../icons/raster.js';
import type { IconsService } from '../icons/service.js';
import type { SettingsService } from '../settings/service.js';

/**
 * Keeps a directly navigated SVG from running scripts or being framed; as a
 * subresource (<img>, CSS mask) the header has no effect on rendering.
 */
const ICON_FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Icon resolution for clients (#71). The manifest is authenticated like every
 * data route; the files themselves are served without auth on purpose — the
 * browser cannot attach the Bearer token to <img>/mask requests, and the
 * bundled OpenMoji files are public static assets in the same way. The paths
 * live outside /api/ so the service worker's default cache branch covers them
 * offline.
 */
export function iconRoutes(
  icons: IconsService,
  guards: AuthGuards,
  settings: SettingsService,
): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/icons', { preHandler: guards.authenticate }, async (request, reply) => {
      const registry = await icons.registry();
      const defaultPack = String(await settings.effective('icons.pack'));
      const etag = `"${registry.etag}-${defaultPack}"`;
      reply.header('cache-control', 'no-cache');
      reply.header('etag', etag);
      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }
      return {
        defaultPack,
        packs: [
          { id: 'openmoji', kind: 'mono', source: 'bundled' },
          { id: 'fluent', kind: 'color', source: 'bundled' },
          { id: 'custom', kind: 'mixed', source: 'instance' },
        ],
        icons: registry.icons.map((icon) => ({
          id: icon.id,
          kind: icon.kind,
          url: `/icons/custom/${icon.file}`,
          // For clients without an SVG decoder (#103); png/webp sources
          // answer it with the stored file unchanged.
          rasterUrl: `/icons/custom/${icon.file}?format=png&size=${DEFAULT_RASTER_SIZE}`,
        })),
      };
    });

    const rasterizer = createRasterizer(icons.dir, app.log);

    app.get<{ Params: { filename: string }; Querystring: { format?: 'png'; size?: number } }>(
      '/icons/custom/:filename',
      {
        schema: {
          params: {
            type: 'object',
            required: ['filename'],
            properties: { filename: { type: 'string', maxLength: 64 } },
            additionalProperties: false,
          },
          querystring: {
            type: 'object',
            properties: {
              format: { type: 'string', enum: ['png'] },
              size: { type: 'integer', enum: [...RASTER_SIZES] },
            },
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const registry = await icons.registry();
        // Only scanned (validated) files are served; the path comes from the
        // registry, never from the request, so there is nothing to traverse.
        const icon = registry.byFile.get(request.params.filename);
        if (icon === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }

        // Raster variant (#103): only SVG needs it — stored png/webp answer
        // a format=png request unchanged, native clients decode those.
        const wantsRaster = request.query.format === 'png' && icon.contentType === 'image/svg+xml';
        const size = request.query.size ?? DEFAULT_RASTER_SIZE;

        let content: Buffer | undefined;
        let contentType = icon.contentType;
        let variant = '';
        if (wantsRaster) {
          content = await rasterizer.render(icon.file, size);
          contentType = 'image/png';
          variant = `-png${size}`;
        } else {
          try {
            content = await readFile(join(icons.dir, icon.file));
          } catch {
            content = undefined;
          }
        }
        if (content === undefined) {
          return reply.code(404).send({ error: 'not_found' });
        }

        const etag = `"${registry.etag}-${icon.file}${variant}"`;
        reply.header('cache-control', 'no-cache');
        reply.header('etag', etag);
        reply.header('content-type', contentType);
        reply.header('content-security-policy', ICON_FILE_CSP);
        reply.header('content-disposition', 'attachment');
        reply.header('x-content-type-options', 'nosniff');
        if (request.headers['if-none-match'] === etag) {
          return reply.code(304).send();
        }
        return reply.send(content);
      },
    );
  };
}

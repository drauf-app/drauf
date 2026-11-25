import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { AuthGuards } from '../auth/guard.js';
import type { IconsService } from '../icons/service.js';

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
export function iconRoutes(icons: IconsService, guards: AuthGuards): FastifyPluginAsync {
  return async (app) => {
    app.get('/api/icons', { preHandler: guards.authenticate }, async (request, reply) => {
      const registry = await icons.registry();
      const etag = `"${registry.etag}"`;
      reply.header('cache-control', 'no-cache');
      reply.header('etag', etag);
      if (request.headers['if-none-match'] === etag) {
        return reply.code(304).send();
      }
      return {
        defaultPack: 'openmoji',
        packs: [
          { id: 'openmoji', kind: 'mono', source: 'bundled' },
          { id: 'custom', kind: 'mixed', source: 'instance' },
        ],
        icons: registry.icons.map((icon) => ({
          id: icon.id,
          kind: icon.kind,
          url: `/icons/custom/${icon.file}`,
        })),
      };
    });

    app.get<{ Params: { filename: string } }>(
      '/icons/custom/:filename',
      {
        schema: {
          params: {
            type: 'object',
            required: ['filename'],
            properties: { filename: { type: 'string', maxLength: 64 } },
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
        let content: Buffer;
        try {
          content = await readFile(join(icons.dir, icon.file));
        } catch {
          return reply.code(404).send({ error: 'not_found' });
        }
        const etag = `"${registry.etag}-${icon.file}"`;
        reply.header('cache-control', 'no-cache');
        reply.header('etag', etag);
        reply.header('content-type', icon.contentType);
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

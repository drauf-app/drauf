import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { AVATAR_CONTENT_TYPES, AVATAR_KEY_PATTERN } from '../avatars/service.js';
import type { Database } from '../db/index.js';
import { getUserByAvatarKey } from '../db/repositories.js';

/** Same defense-in-depth as instance icon files (#71): never render as a page. */
const AVATAR_FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/**
 * Serves cached avatars (#98). Unauthenticated on purpose: `<img>` requests
 * cannot carry a Bearer token (same constraint as custom icons), so the
 * protection is the key itself — random, per user, rotated on every image
 * change. Outside /api/, so the service worker caches avatars for offline.
 */
export function avatarRoutes(database: Database, avatarsDir: string): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Params: { key: string } }>(
      '/avatars/:key',
      {
        schema: {
          params: {
            type: 'object',
            required: ['key'],
            properties: { key: { type: 'string', maxLength: 64 } },
            additionalProperties: false,
          },
        },
      },
      async (request, reply) => {
        const key = request.params.key;
        if (!AVATAR_KEY_PATTERN.test(key)) {
          return reply.code(404).send({ error: 'not_found' });
        }
        // Only keys the database vouches for are served; the file path is
        // built from that stored value, never from free-form input.
        const user = await getUserByAvatarKey(database, key);
        if (user === undefined || user.avatarKey === null) {
          return reply.code(404).send({ error: 'not_found' });
        }
        let content: Buffer;
        try {
          content = await readFile(join(avatarsDir, user.avatarKey));
        } catch {
          return reply.code(404).send({ error: 'not_found' });
        }
        const extension = user.avatarKey.slice(user.avatarKey.lastIndexOf('.') + 1);
        // The key rotates when the image changes, so caching hard is safe.
        reply.header('cache-control', 'public, max-age=31536000, immutable');
        reply.header('content-type', AVATAR_CONTENT_TYPES[extension] ?? 'application/octet-stream');
        reply.header('content-security-policy', AVATAR_FILE_CSP);
        reply.header('content-disposition', 'attachment');
        reply.header('x-content-type-options', 'nosniff');
        return reply.send(content);
      },
    );
  };
}

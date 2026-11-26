import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

// No third-party assets, no inline scripts: everything is bundled. Inline
// styles are allowed — dynamic values (list colours, print orientation) need
// them, and style injection without script execution is a minor risk.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

/**
 * Serves the built web app with a strict CSP and an SPA fallback to
 * index.html. Does nothing (and returns false) when the directory is missing,
 * e.g. in development where Vite serves the web app itself.
 */
export async function registerWebApp(app: FastifyInstance, webDir: string): Promise<boolean> {
  const root = resolve(webDir);
  if (!existsSync(root)) {
    return false;
  }

  await app.register(fastifyStatic, {
    root,
    setHeaders: (reply, filePath) => {
      // Vite content-hashes everything under assets/; index.html must revalidate.
      reply.header(
        'cache-control',
        filePath.includes(`${sep}assets${sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      );
    },
  });

  app.addHook('onSend', async (request, reply) => {
    // Instance icon files (#71) and avatars (#98) set their own stricter headers.
    if (
      !request.url.startsWith('/api/') &&
      !request.url.startsWith('/icons/') &&
      !request.url.startsWith('/avatars/') &&
      request.url !== '/healthz'
    ) {
      reply.header('content-security-policy', CONTENT_SECURITY_POLICY);
      reply.header('x-content-type-options', 'nosniff');
      reply.header('referrer-policy', 'no-referrer');
    }
  });

  // Client-side routes (e.g. /plan) are unknown to the server: hand them
  // index.html. API routes keep their JSON 404s to avoid confusing clients.
  app.setNotFoundHandler((request, reply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return reply.code(404).send({ error: 'not_found' });
    }
    if (request.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });

  return true;
}

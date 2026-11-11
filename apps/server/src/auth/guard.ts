import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifyAccessToken } from './tokens.js';

export interface AuthUser {
  id: string;
  isAdmin: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: AuthUser;
  }
}

export interface AuthGuards {
  /** Rejects the request with 401 unless a valid Bearer access token is presented. */
  authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Must run after authenticate; rejects with 403 unless the token has the admin claim. */
  requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function createAuthGuards(secret: string): AuthGuards {
  return {
    async authenticate(request, reply) {
      const header = request.headers.authorization;
      if (header === undefined || !header.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      const claims = await verifyAccessToken(secret, header.slice('Bearer '.length));
      if (claims === undefined) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      request.authUser = { id: claims.userId, isAdmin: claims.isAdmin };
    },
    async requireAdmin(request, reply) {
      if (request.authUser?.isAdmin !== true) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    },
  };
}

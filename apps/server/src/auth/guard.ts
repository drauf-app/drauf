import { type ApiTokenArea, isApiTokenScope } from '@drauf/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../db/index.js';
import { getApiTokenByHash, touchApiToken } from '../db/repositories.js';
import { API_TOKEN_PREFIX, API_TOKEN_TOUCH_INTERVAL_MS, hashApiToken } from './api-tokens.js';
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

type Guard = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

export interface AuthGuards {
  /**
   * Rejects the request with 401 unless a valid Bearer access token is
   * presented. API tokens are refused here (403): only route groups that opt
   * in via forArea accept them, so forgetting a scope check fails closed.
   */
  authenticate: Guard;
  /** Must run after authenticate; rejects with 403 unless the token has the admin claim. */
  requireAdmin: Guard;
  /**
   * Like authenticate, but additionally accepts API tokens that carry the
   * scope `<area>:read` (GET/HEAD) or `<area>:write` (everything else).
   */
  forArea: (area: ApiTokenArea) => Guard;
}

/** Mirrors the login rate limit for guesses at token secrets, keyed by IP. */
const TOKEN_FAILURE_LIMIT = 10;
const TOKEN_FAILURE_WINDOW_MS = 60_000;

export function createAuthGuards(secret: string, database: Database): AuthGuards {
  const failures = new Map<string, { count: number; resetAt: number }>();

  function failedTokenAttempt(ip: string): boolean {
    const now = Date.now();
    const entry = failures.get(ip);
    if (entry === undefined || entry.resetAt <= now) {
      // Also drop other stale entries so the map cannot grow without bound.
      for (const [key, value] of failures) {
        if (value.resetAt <= now) {
          failures.delete(key);
        }
      }
      failures.set(ip, { count: 1, resetAt: now + TOKEN_FAILURE_WINDOW_MS });
      return false;
    }
    entry.count += 1;
    return entry.count > TOKEN_FAILURE_LIMIT;
  }

  async function authenticateSession(
    request: FastifyRequest,
    reply: FastifyReply,
    bearer: string,
  ): Promise<void> {
    const claims = await verifyAccessToken(secret, bearer);
    if (claims === undefined) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    request.authUser = { id: claims.userId, isAdmin: claims.isAdmin };
  }

  function bearerOf(request: FastifyRequest): string | undefined {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      return undefined;
    }
    return header.slice('Bearer '.length);
  }

  return {
    async authenticate(request, reply) {
      const bearer = bearerOf(request);
      if (bearer === undefined) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
      if (bearer.startsWith(API_TOKEN_PREFIX)) {
        // No lookup: this route group is not token-accessible at all.
        return reply.code(403).send({ error: 'insufficient_scope' });
      }
      return authenticateSession(request, reply, bearer);
    },

    async requireAdmin(request, reply) {
      if (request.authUser?.isAdmin !== true) {
        return reply.code(403).send({ error: 'forbidden' });
      }
    },

    forArea(area) {
      return async (request, reply) => {
        const bearer = bearerOf(request);
        if (bearer === undefined) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
        if (!bearer.startsWith(API_TOKEN_PREFIX)) {
          return authenticateSession(request, reply, bearer);
        }

        const ip = request.ip;
        const limited = failures.get(ip);
        if (limited !== undefined && limited.resetAt > Date.now()) {
          if (limited.count > TOKEN_FAILURE_LIMIT) {
            return reply.code(429).send({ error: 'rate_limited' });
          }
        }
        const token = await getApiTokenByHash(database, hashApiToken(bearer));
        if (token === undefined) {
          failedTokenAttempt(ip);
          return reply.code(401).send({ error: 'unauthorized' });
        }

        const scopes = parseScopes(token.scopes);
        const verb = request.method === 'GET' || request.method === 'HEAD' ? 'read' : 'write';
        if (!scopes.includes(`${area}:${verb}`)) {
          return reply.code(403).send({ error: 'insufficient_scope' });
        }

        // The token acts as its user for household/list authorization, but
        // never carries admin powers, whatever the user's own role is.
        request.authUser = { id: token.userId, isAdmin: false };
        const now = new Date();
        if (
          token.lastUsedAt === null ||
          now.getTime() - token.lastUsedAt.getTime() >= API_TOKEN_TOUCH_INTERVAL_MS
        ) {
          await touchApiToken(database, token.id, now);
        }
      };
    },
  };
}

function parseScopes(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((value) => typeof value === 'string' && isApiTokenScope(value));
    }
  } catch {
    // Fall through: a corrupt scopes column grants nothing.
  }
  return [];
}

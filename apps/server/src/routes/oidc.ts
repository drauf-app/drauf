import type { FastifyPluginAsync } from 'fastify';
import { OidcError, type OidcService } from '../auth/oidc.js';
import { issueTokens } from '../auth/service.js';
import { hashRefreshToken } from '../auth/tokens.js';
import type { Config } from '../config.js';
import type { Database } from '../db/index.js';
import { consumeLoginCode, getUserById } from '../db/repositories.js';
import { toPublicUser } from '../users/service.js';

const loginQuery = {
  type: 'object',
  properties: {
    redirect: { type: 'string', maxLength: 1024 },
    deviceName: { type: 'string', maxLength: 128 },
  },
  additionalProperties: false,
} as const;

const exchangeBody = {
  type: 'object',
  required: ['code'],
  properties: {
    code: { type: 'string', maxLength: 256 },
  },
  additionalProperties: false,
} as const;

interface LoginQueryInput {
  redirect?: string;
  deviceName?: string;
}

interface ExchangeInput {
  code: string;
}

function isAllowedRedirect(redirect: string, appRedirects: string[]): boolean {
  if (redirect.startsWith('/') && !redirect.startsWith('//')) {
    return true;
  }
  return appRedirects.some((prefix) => redirect.startsWith(prefix));
}

function appendLoginCode(redirect: string, loginCode: string): string {
  return `${redirect}${redirect.includes('?') ? '&' : '?'}login_code=${encodeURIComponent(loginCode)}`;
}

export function oidcRoutes(
  database: Database,
  config: Config,
  service: OidcService | undefined,
): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: LoginQueryInput }>(
      '/login',
      {
        schema: { querystring: loginQuery },
        config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        if (service === undefined || config.oidc === undefined) {
          return reply.code(404).send({ error: 'oidc_disabled' });
        }
        const redirect = request.query.redirect ?? '/';
        if (!isAllowedRedirect(redirect, config.oidc.appRedirects)) {
          return reply.code(400).send({ error: 'invalid_redirect' });
        }
        try {
          const url = await service.buildLoginRedirect(
            database,
            redirect,
            request.query.deviceName ?? null,
          );
          return reply.redirect(url);
        } catch (err) {
          request.log.warn({ err }, 'oidc login redirect failed');
          return reply.code(503).send({ error: 'oidc_unavailable' });
        }
      },
    );

    app.get('/callback', async (request, reply) => {
      if (service === undefined || config.publicUrl === undefined) {
        return reply.code(404).send({ error: 'oidc_disabled' });
      }
      const currentUrl = new URL(request.url, config.publicUrl);
      try {
        const { clientRedirect, loginCode } = await service.handleCallback(database, currentUrl);
        return reply.redirect(appendLoginCode(clientRedirect, loginCode));
      } catch (err) {
        request.log.warn({ err }, 'oidc callback failed');
        if (err instanceof OidcError && err.code === 'invalid_state') {
          return reply.code(400).send({ error: err.code });
        }
        return reply
          .code(502)
          .send({ error: err instanceof OidcError ? err.code : 'exchange_failed' });
      }
    });

    app.post<{ Body: ExchangeInput }>(
      '/exchange',
      {
        schema: { body: exchangeBody },
        config: { rateLimit: { max: 60, timeWindow: 60_000 } },
      },
      async (request, reply) => {
        if (service === undefined) {
          return reply.code(404).send({ error: 'oidc_disabled' });
        }
        const row = await consumeLoginCode(database, hashRefreshToken(request.body.code));
        const user = row === undefined ? undefined : await getUserById(database, row.userId);
        if (row === undefined || user === undefined) {
          return reply.code(401).send({ error: 'invalid_login_code' });
        }
        const pair = await issueTokens(database, config.authSecret, user, row.deviceName);
        return { ...pair, user: toPublicUser(user) };
      },
    );
  };
}

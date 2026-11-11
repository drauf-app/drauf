import { randomBytes } from 'node:crypto';
import * as oidcClient from 'openid-client';
import type { OidcConfig } from '../config.js';
import type { Database } from '../db/index.js';
import {
  addHouseholdMember,
  consumeOidcTransaction,
  createLoginCode,
  createOidcTransaction,
  createUser,
  createUserIdentity,
  getDefaultHousehold,
  getUserById,
  getUserByUsername,
  getUserIdentity,
  setUserAdmin,
} from '../db/repositories.js';
import type { User } from '../db/schema/types.js';
import { hashRefreshToken } from './tokens.js';

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const LOGIN_CODE_TTL_MS = 60 * 1000;
const DISCOVERY_CACHE_MS = 60 * 60 * 1000;

export type OidcErrorCode = 'oidc_unavailable' | 'invalid_state' | 'exchange_failed';

export class OidcError extends Error {
  readonly code: OidcErrorCode;

  constructor(code: OidcErrorCode, cause?: unknown) {
    super(code, { cause });
    this.code = code;
  }
}

export interface OidcService {
  /** Stores a transaction and returns the IdP authorization URL to redirect to. */
  buildLoginRedirect(
    database: Database,
    clientRedirect: string,
    deviceName: string | null,
  ): Promise<string>;
  /** Handles the IdP callback; returns the client redirect and a one-time login code. */
  handleCallback(
    database: Database,
    currentUrl: URL,
  ): Promise<{ clientRedirect: string; loginCode: string }>;
}

export function createOidcService(oidc: OidcConfig, publicUrl: string): OidcService {
  const callbackUrl = `${publicUrl}/api/auth/oidc/callback`;
  const issuerUrl = new URL(oidc.issuer);
  let cached: { configuration: oidcClient.Configuration; fetchedAt: number } | undefined;

  // Discovery runs lazily on the first login attempt and is cached, never at
  // startup: the server must come up (local accounts) when the IdP is down.
  async function getConfiguration(): Promise<oidcClient.Configuration> {
    if (cached !== undefined && Date.now() - cached.fetchedAt < DISCOVERY_CACHE_MS) {
      return cached.configuration;
    }
    try {
      const configuration = await oidcClient.discovery(
        issuerUrl,
        oidc.clientId,
        oidc.clientSecret,
        undefined,
        // Plain http happens for IdPs on a LAN and in tests; https stays strict.
        issuerUrl.protocol === 'http:' ? { execute: [oidcClient.allowInsecureRequests] } : {},
      );
      cached = { configuration, fetchedAt: Date.now() };
      return configuration;
    } catch (cause) {
      throw new OidcError('oidc_unavailable', cause);
    }
  }

  async function findOrCreateUser(database: Database, claims: oidcClient.IDToken): Promise<User> {
    const identity = await getUserIdentity(database, claims.iss, claims.sub);
    let user: User;
    if (identity !== undefined) {
      const existing = await getUserById(database, identity.userId);
      if (existing === undefined) {
        throw new OidcError('exchange_failed');
      }
      user = existing;
    } else {
      const username = await deriveUsername(database, claims);
      const displayName = typeof claims.name === 'string' ? claims.name : username;
      user = await createUser(database, { username, displayName, passwordHash: null });
      await createUserIdentity(database, {
        userId: user.id,
        issuer: claims.iss,
        subject: claims.sub,
      });
      const household = await getDefaultHousehold(database);
      if (household !== undefined) {
        await addHouseholdMember(database, household.id, user.id);
      }
    }

    // The IdP group is the source of truth for admin on OIDC accounts:
    // membership grants it, absence revokes it, on every login.
    if (oidc.adminGroup !== undefined) {
      const groups = claims[oidc.groupsClaim];
      const isAdmin = Array.isArray(groups) && groups.includes(oidc.adminGroup);
      if (user.isAdmin !== isAdmin) {
        await setUserAdmin(database, user.id, isAdmin);
        user = { ...user, isAdmin };
      }
    }
    return user;
  }

  return {
    async buildLoginRedirect(database, clientRedirect, deviceName) {
      const configuration = await getConfiguration();
      const codeVerifier = oidcClient.randomPKCECodeVerifier();
      const state = oidcClient.randomState();
      const nonce = oidcClient.randomNonce();
      await createOidcTransaction(database, {
        state,
        codeVerifier,
        nonce,
        clientRedirect,
        deviceName,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + TRANSACTION_TTL_MS),
      });
      const url = oidcClient.buildAuthorizationUrl(configuration, {
        redirect_uri: callbackUrl,
        scope: oidc.scopes,
        code_challenge: await oidcClient.calculatePKCECodeChallenge(codeVerifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      });
      return url.href;
    },

    async handleCallback(database, currentUrl) {
      const state = currentUrl.searchParams.get('state');
      const transaction =
        state === null ? undefined : await consumeOidcTransaction(database, state);
      if (transaction === undefined) {
        throw new OidcError('invalid_state');
      }
      const configuration = await getConfiguration();
      let claims: oidcClient.IDToken;
      try {
        const tokens = await oidcClient.authorizationCodeGrant(configuration, currentUrl, {
          pkceCodeVerifier: transaction.codeVerifier,
          expectedState: transaction.state,
          expectedNonce: transaction.nonce,
          idTokenExpected: true,
        });
        const tokenClaims = tokens.claims();
        if (tokenClaims === undefined) {
          throw new Error('no id token claims');
        }
        claims = tokenClaims;
      } catch (cause) {
        throw new OidcError('exchange_failed', cause);
      }

      const user = await findOrCreateUser(database, claims);
      const loginCode = randomBytes(32).toString('base64url');
      await createLoginCode(database, {
        // Same construction as refresh tokens: only the SHA-256 hash is stored.
        codeHash: hashRefreshToken(loginCode),
        userId: user.id,
        deviceName: transaction.deviceName,
        expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS),
      });
      return { clientRedirect: transaction.clientRedirect, loginCode };
    },
  };
}

function sanitizeUsername(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 28);
  return cleaned.length >= 3 ? cleaned : '';
}

async function deriveUsername(database: Database, claims: oidcClient.IDToken): Promise<string> {
  const preferred = typeof claims.preferred_username === 'string' ? claims.preferred_username : '';
  const base =
    sanitizeUsername(preferred) || `user-${sanitizeUsername(claims.sub) || 'oidc'}`.slice(0, 28);
  let candidate = base;
  for (let suffix = 2; (await getUserByUsername(database, candidate)) !== undefined; suffix += 1) {
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

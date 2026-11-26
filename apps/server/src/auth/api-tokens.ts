import { createHash, randomBytes } from 'node:crypto';

/**
 * API tokens (#97): long-lived, revocable credentials for integrations. The
 * prefix makes them recognizable in the Authorization header (and in secret
 * scanners) and cleanly disambiguates them from JWT access tokens.
 */
export const API_TOKEN_PREFIX = 'drauf_';

export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/**
 * SHA-256, not a slow hash: the secret is 32 random bytes, so brute force is
 * hopeless and lookups must stay cheap (one per authenticated request).
 */
export function hashApiToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Update last_used_at at most this often; never one write per request. */
export const API_TOKEN_TOUCH_INTERVAL_MS = 60 * 60 * 1000;

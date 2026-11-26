/**
 * API token scopes (#97). Tokens authenticate as their user but are further
 * restricted to coarse per-area read/write scopes; everything not granted is
 * refused. Session logins (web, iOS) stay unscoped and keep full access.
 */

/** Areas a token can be granted access to; all other routes refuse tokens. */
export const API_TOKEN_AREAS = ['plan', 'lists', 'catalog'] as const;

export type ApiTokenArea = (typeof API_TOKEN_AREAS)[number];

/**
 * The grantable scopes. The catalogue is read-only on purpose: writes happen
 * through interactive sessions, so no write scope exists to hand out.
 */
export const API_TOKEN_SCOPES = [
  'plan:read',
  'plan:write',
  'lists:read',
  'lists:write',
  'catalog:read',
] as const;

export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

export function isApiTokenScope(value: string): value is ApiTokenScope {
  return (API_TOKEN_SCOPES as readonly string[]).includes(value);
}

export const API_TOKEN_NAME_MAX_LENGTH = 64;

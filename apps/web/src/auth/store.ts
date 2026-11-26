import { useSyncExternalStore } from 'react';
import type { PublicUser, TokenPair } from '../api/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string) {
    super(`${status} ${code}`);
    this.status = status;
    this.code = code;
  }
}

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: PublicUser | undefined;
}

const REFRESH_TOKEN_KEY = 'drauf.refresh-token';
const JSON_HEADERS = { 'content-type': 'application/json' };

let state: AuthState = { status: 'loading', user: undefined };
let accessToken: string | undefined;
let refreshInFlight: Promise<boolean> | undefined;
const listeners = new Set<() => void>();

function setState(next: AuthState): void {
  state = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, () => state);
}

// localStorage can throw (private mode, blocked site data); the app must
// still work for the current page load, just without a persisted session.
function readStoredRefreshToken(): string | undefined {
  try {
    return localStorage.getItem(REFRESH_TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeStoredRefreshToken(token: string): void {
  try {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } catch {
    // Session lives only as long as the page then.
  }
}

function removeStoredRefreshToken(): void {
  try {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // Nothing stored that we could remove.
  }
}

function clearSession(): void {
  accessToken = undefined;
  removeStoredRefreshToken();
  setState({ status: 'signedOut', user: undefined });
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? 'request_failed';
  } catch {
    return 'request_failed';
  }
}

async function doRefresh(): Promise<boolean> {
  const stored = readStoredRefreshToken();
  if (stored === undefined) {
    return false;
  }
  const response = await fetch('/api/auth/refresh', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ refreshToken: stored }),
  });
  if (response.status === 401) {
    // The token was revoked or already rotated away: this session is gone.
    clearSession();
    return false;
  }
  if (!response.ok) {
    return false;
  }
  const pair = (await response.json()) as TokenPair;
  accessToken = pair.accessToken;
  writeStoredRefreshToken(pair.refreshToken);
  return true;
}

/** Refreshes the access token; concurrent callers share one request. */
function refreshSession(): Promise<boolean> {
  refreshInFlight ??= doRefresh().finally(() => {
    refreshInFlight = undefined;
  });
  return refreshInFlight;
}

/**
 * fetch with the access token attached; on 401 the token is refreshed once
 * and the request retried. Throws ApiError for non-2xx responses.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (): Promise<Response> =>
    fetch(path, {
      ...init,
      headers: {
        // Only requests with a body are JSON; Fastify rejects an empty body
        // when the content type claims JSON (e.g. DELETE, check/uncheck).
        ...(init.body == null ? {} : JSON_HEADERS),
        ...(init.headers ?? {}),
        ...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
      },
    });

  let response = await send();
  if (response.status === 401 && (await refreshSession())) {
    response = await send();
  }
  if (!response.ok) {
    throw new ApiError(response.status, await errorCode(response));
  }
  return response;
}

export async function apiJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  return (await response.json()) as T;
}

/** Reflects profile edits (#98) in the header without a full refetch. */
export function setCurrentUser(user: PublicUser): void {
  if (state.status === 'signedIn') {
    setState({ status: 'signedIn', user });
  }
}

async function adoptSession(pair: TokenPair & { user: PublicUser }): Promise<void> {
  accessToken = pair.accessToken;
  writeStoredRefreshToken(pair.refreshToken);
  setState({ status: 'signedIn', user: pair.user });
}

/** Current access token (if any) plus a refresh fallback, e.g. for WebSocket auth. */
export async function ensureAccessToken(): Promise<string | undefined> {
  if (accessToken !== undefined) {
    return accessToken;
  }
  try {
    await refreshSession();
  } catch {
    return undefined;
  }
  return accessToken;
}

/** A short device label for the server's refresh-token list. */
export function deviceName(): string {
  const match = /iPhone|iPad|Android|Macintosh|Windows|Linux/.exec(navigator.userAgent);
  return match === null ? 'Web' : `Web (${match[0]})`;
}

/** Restores the session from a stored refresh token at startup. */
export async function initAuth(): Promise<void> {
  if (readStoredRefreshToken() === undefined) {
    setState({ status: 'signedOut', user: undefined });
    return;
  }
  try {
    if (!(await refreshSession())) {
      setState({ status: 'signedOut', user: undefined });
      return;
    }
    const user = await apiJson<PublicUser>('/api/auth/me');
    setState({ status: 'signedIn', user });
  } catch {
    // Server unreachable (e.g. offline): keep the stored token for the next
    // start, but there is no session to restore right now.
    setState({ status: 'signedOut', user: undefined });
  }
}

export async function loginLocal(username: string, password: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ username, password, deviceName: deviceName() }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await errorCode(response));
  }
  await adoptSession((await response.json()) as TokenPair & { user: PublicUser });
}

/** Trades a one-time OIDC login code (from the callback URL) for tokens. */
export async function exchangeOidcCode(code: string): Promise<void> {
  const response = await fetch('/api/auth/oidc/exchange', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ code }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, await errorCode(response));
  }
  await adoptSession((await response.json()) as TokenPair & { user: PublicUser });
}

export async function logout(): Promise<void> {
  const stored = readStoredRefreshToken();
  if (stored !== undefined) {
    // Best effort: the local session ends even if the server is unreachable.
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ refreshToken: stored }),
      });
    } catch {
      // Offline logout: the refresh token stays valid server-side until it
      // expires or is revoked from another device.
    }
  }
  clearSession();
}

/** Test seam: resets module state between test cases. */
export function resetAuthForTests(): void {
  state = { status: 'loading', user: undefined };
  accessToken = undefined;
  refreshInFlight = undefined;
  listeners.clear();
}

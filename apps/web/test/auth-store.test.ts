import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicUser } from '../src/api/types';
import { ApiError, apiFetch, initAuth, loginLocal, logout, useAuth } from '../src/auth/store';
import { authHeaderOf, fakeResponse, stubFetch } from './fake-fetch';

const USER: PublicUser = {
  id: 'u1',
  username: 'kathrin',
  displayName: 'Kathrin',
  isAdmin: false,
  createdAt: '2026-11-12T00:00:00.000Z',
};

const REFRESH_TOKEN_KEY = 'drauf.refresh-token';

function authStatus(): string {
  const { result } = renderHook(() => useAuth());
  return result.current.status;
}

describe('initAuth', () => {
  it('signs out when no refresh token is stored', async () => {
    const requests = stubFetch(() => fakeResponse(500, {}));
    await initAuth();
    expect(authStatus()).toBe('signedOut');
    // No network call must happen without a stored token.
    expect(requests).toHaveLength(0);
  });

  it('restores the session from a stored refresh token', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'stored-token');
    const requests = stubFetch((url) => {
      if (url === '/api/auth/refresh') {
        return fakeResponse(200, { accessToken: 'access-1', refreshToken: 'rotated-token' });
      }
      if (url === '/api/auth/me') {
        return fakeResponse(200, USER);
      }
      return undefined;
    });

    await initAuth();

    expect(authStatus()).toBe('signedIn');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('rotated-token');
    const me = requests.find((request) => request.url === '/api/auth/me');
    expect(me).toBeDefined();
    expect(me === undefined ? undefined : authHeaderOf(me)).toBe('Bearer access-1');
  });

  it('clears the stored token when the refresh token is rejected', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'revoked-token');
    stubFetch((url) =>
      url === '/api/auth/refresh'
        ? fakeResponse(401, { error: 'invalid_refresh_token' })
        : undefined,
    );

    await initAuth();

    expect(authStatus()).toBe('signedOut');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('keeps the stored token when the server is unreachable', async () => {
    localStorage.setItem(REFRESH_TOKEN_KEY, 'stored-token');
    stubFetch(() => undefined); // every call fails like a network error

    await initAuth();

    expect(authStatus()).toBe('signedOut');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('stored-token');
  });
});

describe('apiFetch', () => {
  it('retries once with a fresh access token after a 401', async () => {
    const listCalls: Array<string | undefined> = [];
    const requests = stubFetch((url, init) => {
      if (url === '/api/auth/login') {
        return fakeResponse(200, {
          accessToken: 'access-old',
          refreshToken: 'refresh-1',
          user: USER,
        });
      }
      if (url === '/api/auth/refresh') {
        return fakeResponse(200, { accessToken: 'access-new', refreshToken: 'refresh-2' });
      }
      if (url === '/api/lists') {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        listCalls.push(headers.authorization);
        return listCalls.length === 1
          ? fakeResponse(401, { error: 'unauthorized' })
          : fakeResponse(200, []);
      }
      return undefined;
    });

    await loginLocal('kathrin', 'correct-horse-battery');
    const response = await apiFetch('/api/lists');

    expect(response.status).toBe(200);
    expect(listCalls).toEqual(['Bearer access-old', 'Bearer access-new']);
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('refresh-2');
    expect(requests.filter((request) => request.url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('throws a typed ApiError with the server error code', async () => {
    stubFetch((url) =>
      url === '/api/lists/nope' ? fakeResponse(404, { error: 'not_found' }) : undefined,
    );

    const error = await apiFetch('/api/lists/nope').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(404);
    expect((error as ApiError).code).toBe('not_found');
  });
});

describe('loginLocal and logout', () => {
  it('maps a failed login to an ApiError with the server code', async () => {
    stubFetch((url) =>
      url === '/api/auth/login' ? fakeResponse(401, { error: 'invalid_credentials' }) : undefined,
    );

    const error = await loginLocal('kathrin', 'wrong').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe('invalid_credentials');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });

  it('revokes the refresh token on logout and clears the session', async () => {
    const requests = stubFetch((url) => {
      if (url === '/api/auth/login') {
        return fakeResponse(200, { accessToken: 'a', refreshToken: 'r', user: USER });
      }
      if (url === '/api/auth/logout') {
        return fakeResponse(204, {});
      }
      return undefined;
    });

    await loginLocal('kathrin', 'correct-horse-battery');
    await logout();

    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    const logoutRequest = requests.find((request) => request.url === '/api/auth/logout');
    expect(logoutRequest?.init?.body).toContain('"refreshToken":"r"');
  });

  it('ends the local session even when the server is unreachable', async () => {
    stubFetch((url) =>
      url === '/api/auth/login'
        ? fakeResponse(200, { accessToken: 'a', refreshToken: 'r', user: USER })
        : undefined,
    );

    await loginLocal('kathrin', 'correct-horse-battery');
    await logout();

    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
  });
});

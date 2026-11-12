import { vi } from 'vitest';

export interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

/** Minimal Response stand-in covering what the auth store reads. */
export function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

export type RouteHandler = (url: string, init: RequestInit | undefined) => Response | undefined;

/** Replaces global fetch; unmatched URLs reject like a network error. */
export function stubFetch(handler: RouteHandler): RecordedRequest[] {
  const requests: RecordedRequest[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      const response = handler(url, init);
      if (response === undefined) {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return Promise.resolve(response);
    }),
  );
  return requests;
}

export function authHeaderOf(request: RecordedRequest): string | undefined {
  const headers = (request.init?.headers ?? {}) as Record<string, string>;
  return headers.authorization;
}

import dns from 'node:dns';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

const MAX_REDIRECTS = 5;

export type FetchGuardErrorCode =
  | 'invalid_url'
  | 'blocked_address'
  | 'fetch_failed'
  | 'upstream_error'
  | 'too_many_redirects'
  | 'unsupported_content'
  | 'too_large'
  | 'timeout';

export class FetchGuardError extends Error {
  readonly code: FetchGuardErrorCode;
  /** HTTP status of the upstream answer, when one was received. */
  readonly status: number | undefined;

  constructor(code: FetchGuardErrorCode, cause?: unknown, status?: number) {
    super(status === undefined ? code : `${code} (${status})`, { cause });
    this.code = code;
    this.status = status;
  }
}

/** Private, loopback, link-local and other non-public addresses (SSRF guard). */
export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(normalized) === 4) {
    const parts = normalized.split('.').map(Number);
    const [a = 0, b = 0] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  // IPv6: loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10).
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

// DNS results are validated at connect time, which also covers rebinding
// between a pre-check and the actual connection.
const guardedLookup = ((hostname: string, options: unknown, callback?: unknown) => {
  const cb = (typeof options === 'function' ? options : callback) as (...args: unknown[]) => void;
  const opts = (
    typeof options === 'object' && options !== null ? options : {}
  ) as dns.LookupOptions;
  dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
    if (err !== null) {
      cb(err);
      return;
    }
    const list = addresses as unknown as dns.LookupAddress[];
    const first = list[0];
    if (first === undefined || list.some((entry) => isPrivateAddress(entry.address))) {
      cb(Object.assign(new Error('address blocked'), { code: 'EADDRBLOCKED' }));
      return;
    }
    if (opts.all === true) {
      cb(null, list);
    } else {
      cb(null, first.address, first.family);
    }
  });
}) as typeof dns.lookup;

const dispatcher = new Agent({ connect: { lookup: guardedLookup } });

export interface GuardedFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  accept: string;
  /** Content types the response must start with. */
  allowedContentTypes: string[];
}

export interface GuardedFetchResult {
  body: Buffer;
  contentType: string;
  finalUrl: string;
}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchGuardError('invalid_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchGuardError('invalid_url');
  }
  // Literal IPs skip DNS and therefore the lookup guard: check them here.
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hostname) !== 0 && isPrivateAddress(hostname)) {
    throw new FetchGuardError('blocked_address');
  }
  return url;
}

/**
 * Fetches a public URL with the SSRF guard, a timeout, a size cap and manual
 * redirect handling so every hop (including literal-IP redirects) is checked.
 */
export async function fetchGuarded(
  rawUrl: string,
  options: GuardedFetchOptions,
): Promise<GuardedFetchResult> {
  let url = checkUrl(rawUrl);
  const signal = AbortSignal.timeout(options.timeoutMs);

  for (let redirects = 0; ; redirects += 1) {
    // undici's own fetch, not the global one: the global fetch is backed by
    // Node's bundled undici, whose dispatcher protocol can disagree with the
    // npm package the Agent comes from ("invalid onRequestStart method" on
    // node:24-slim). Same-library fetch + Agent can never mismatch.
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(url, {
        redirect: 'manual',
        signal,
        headers: { accept: options.accept, 'user-agent': 'Drauf (self-hosted recipe import)' },
        dispatcher,
      });
    } catch (cause) {
      if (signal.aborted) {
        throw new FetchGuardError('timeout', cause);
      }
      const message = cause instanceof Error ? String(cause.cause ?? cause.message) : '';
      throw new FetchGuardError(
        message.includes('EADDRBLOCKED') ? 'blocked_address' : 'fetch_failed',
        cause,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (location === null || redirects >= MAX_REDIRECTS) {
        throw new FetchGuardError('too_many_redirects', undefined, response.status);
      }
      url = checkUrl(new URL(location, url).href);
      continue;
    }

    if (!response.ok) {
      // A CDN/WAF block (403) looks very different from a vanished recipe
      // (404) when debugging — carry the status instead of hiding it (#50).
      await response.body?.cancel();
      throw new FetchGuardError('upstream_error', undefined, response.status);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!options.allowedContentTypes.some((allowed) => contentType.startsWith(allowed))) {
      await response.body?.cancel();
      throw new FetchGuardError('unsupported_content');
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    if (response.body !== null) {
      for await (const chunk of response.body) {
        total += chunk.length;
        if (total > options.maxBytes) {
          await response.body.cancel().catch(() => {});
          throw new FetchGuardError('too_large');
        }
        chunks.push(chunk);
      }
    }
    return { body: Buffer.concat(chunks), contentType, finalUrl: url.href };
  }
}

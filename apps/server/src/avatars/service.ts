import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/index.js';
import { getUserById, setUserAvatarKey } from '../db/repositories.js';
import { fetchGuarded } from '../import/fetch.js';

/**
 * Cached IdP profile pictures (#98). The server fetches the `picture` claim
 * at login and serves the image itself, so clients never contact the IdP
 * (same privacy rule as recipe images). Files live in DATA_DIR/avatars under
 * a random per-user key that rotates whenever the image changes: avatar URLs
 * are unguessable and cache-bust themselves.
 */

const MAX_AVATAR_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 5000;
const ACCEPT = 'image/png,image/jpeg,image/webp';

export const AVATAR_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const AVATAR_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/** Exactly what newAvatarKey produces; anything else 404s without a lookup. */
export const AVATAR_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\.(png|jpg|webp)$/;

function newAvatarKey(extension: string): string {
  // 16 random bytes = 22 base64url chars; the extension rides along so the
  // serve route knows the content type without touching the file.
  return `${randomBytes(16).toString('base64url')}.${extension}`;
}

export interface AvatarService {
  readonly dir: string;
  /**
   * Fetches the picture behind `pictureUrl` and caches it for the user;
   * `undefined` clears a previously cached avatar. Never throws — a broken
   * avatar must not break a login — and only writes when the bytes changed.
   */
  sync(database: Database, userId: string, pictureUrl: string | undefined): Promise<void>;
}

export function createAvatarService(
  dir: string,
  issuer: string,
  log: FastifyBaseLogger,
): AvatarService {
  const issuerOrigin = new URL(issuer).origin;

  async function fetchPicture(pictureUrl: string): Promise<{ body: Buffer; extension: string }> {
    const url = new URL(pictureUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
    let body: Buffer;
    let contentType: string;
    if (url.origin === issuerOrigin) {
      // The IdP itself is admin-configured and as trusted as its discovery
      // and token endpoints — and may well live on a LAN address, which the
      // SSRF guard would (rightly) refuse for arbitrary URLs.
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { accept: ACCEPT },
      });
      if (!response.ok) {
        throw new Error(`upstream ${response.status}`);
      }
      const declared = Number(response.headers.get('content-length') ?? '0');
      if (declared > MAX_AVATAR_BYTES) {
        throw new Error('too large');
      }
      contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
      body = Buffer.from(await response.arrayBuffer());
    } else {
      // Any other host gets the full public-address-only treatment.
      const result = await fetchGuarded(pictureUrl, {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: MAX_AVATAR_BYTES,
        accept: ACCEPT,
        allowedContentTypes: Object.keys(AVATAR_EXTENSIONS),
      });
      body = result.body;
      contentType = result.contentType;
    }
    if (body.length > MAX_AVATAR_BYTES) {
      throw new Error('too large');
    }
    const extension = AVATAR_EXTENSIONS[contentType];
    if (extension === undefined) {
      throw new Error(`unsupported content type ${contentType}`);
    }
    return { body, extension };
  }

  return {
    dir,

    async sync(database, userId, pictureUrl) {
      try {
        const user = await getUserById(database, userId);
        if (user === undefined) {
          return;
        }
        if (pictureUrl === undefined) {
          if (user.avatarKey !== null) {
            await setUserAvatarKey(database, userId, null);
            await rm(join(dir, user.avatarKey), { force: true });
          }
          return;
        }
        const { body, extension } = await fetchPicture(pictureUrl);
        if (user.avatarKey !== null) {
          const existing = await readFile(join(dir, user.avatarKey)).catch(() => undefined);
          if (existing?.equals(body) === true) {
            return;
          }
        }
        const key = newAvatarKey(extension);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, key), body);
        await setUserAvatarKey(database, userId, key);
        if (user.avatarKey !== null) {
          await rm(join(dir, user.avatarKey), { force: true });
        }
      } catch (error) {
        log.warn({ err: error, userId }, 'avatar sync failed; keeping the previous state');
      }
    },
  };
}

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidIconId } from '@drauf/shared';
import type { FastifyBaseLogger } from 'fastify';
import { checkPng, checkSvg, checkWebp, type IconKind, MAX_ICON_BYTES } from './sanitize.js';

/** One instance icon from the data volume, e.g. icons/tomato.svg → custom:tomato. */
export interface InstanceIcon {
  id: string;
  file: string;
  kind: IconKind;
  contentType: string;
}

export interface IconRegistry {
  icons: InstanceIcon[];
  byFile: Map<string, InstanceIcon>;
  etag: string;
}

export interface IconsService {
  registry(): Promise<IconRegistry>;
  readonly dir: string;
}

const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
};

const EMPTY: IconRegistry = { icons: [], byFile: new Map(), etag: 'empty' };

/**
 * Scans DATA_DIR/icons lazily with a short TTL: no fs watcher (unreliable on
 * Docker bind mounts), no restart needed — icons appear and disappear with
 * the files. Validation results are cached per (name, size, mtime), so a
 * steady-state scan costs one readdir plus stats.
 */
export function createIconsService(
  dir: string,
  log: FastifyBaseLogger,
  ttlMs = 10_000,
): IconsService {
  let cached: IconRegistry = EMPTY;
  let cachedAt = 0;
  let scanning: Promise<IconRegistry> | undefined;
  const checked = new Map<string, InstanceIcon | string>(); // stamp → icon or skip reason
  let lastSkipLog = '';

  async function scan(): Promise<IconRegistry> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return EMPTY; // No directory, no instance icons.
    }
    const icons: InstanceIcon[] = [];
    const seenKeys = new Set<string>();
    const skipped: string[] = [];
    const liveStamps = new Set<string>();
    for (const file of names.sort()) {
      const match = /^(.+)\.(svg|png|webp)$/.exec(file);
      if (match === null) {
        continue; // Not an icon file (e.g. a README); silently ignored.
      }
      const [, key, ext] = match as unknown as [string, string, string];
      const id = `custom:${key}`;
      if (!isValidIconId(id) || key.includes('..')) {
        skipped.push(`${file}: file name is not a valid icon key`);
        continue;
      }
      if (seenKeys.has(key)) {
        skipped.push(`${file}: duplicate key '${key}'`);
        continue;
      }
      let size: number;
      let mtimeMs: number;
      try {
        const info = await stat(join(dir, file));
        if (!info.isFile()) {
          continue;
        }
        size = info.size;
        mtimeMs = info.mtimeMs;
      } catch {
        continue; // Deleted between readdir and stat.
      }
      const stamp = `${file}:${size}:${mtimeMs}`;
      liveStamps.add(stamp);
      let result = checked.get(stamp);
      if (result === undefined) {
        result = await validate(dir, file, id, ext, size);
        checked.set(stamp, result);
      }
      if (typeof result === 'string') {
        skipped.push(`${file}: ${result}`);
        continue;
      }
      seenKeys.add(key);
      icons.push(result);
    }
    for (const stamp of checked.keys()) {
      if (!liveStamps.has(stamp)) {
        checked.delete(stamp);
      }
    }
    const skipLog = skipped.join('; ');
    if (skipLog !== lastSkipLog) {
      lastSkipLog = skipLog;
      if (skipLog !== '') {
        log.warn({ dir, skipped }, 'instance icons skipped');
      }
    }
    const etag = createHash('sha1')
      .update([...liveStamps].sort().join('|'))
      .digest('hex');
    return { icons, byFile: new Map(icons.map((icon) => [icon.file, icon])), etag };
  }

  return {
    dir,
    async registry() {
      const now = Date.now();
      if (now - cachedAt < ttlMs) {
        return cached;
      }
      scanning ??= scan()
        .then((registry) => {
          cached = registry;
          cachedAt = Date.now();
          return registry;
        })
        .finally(() => {
          scanning = undefined;
        });
      return scanning;
    },
  };
}

async function validate(
  dir: string,
  file: string,
  id: string,
  ext: string,
  size: number,
): Promise<InstanceIcon | string> {
  if (size > MAX_ICON_BYTES) {
    return `larger than ${MAX_ICON_BYTES} bytes`;
  }
  let content: Buffer;
  try {
    content = await readFile(join(dir, file));
  } catch {
    return 'unreadable';
  }
  const check =
    ext === 'svg'
      ? checkSvg(content.toString('utf8'))
      : ext === 'png'
        ? checkPng(content)
        : checkWebp(content);
  if (!check.ok) {
    return check.reason;
  }
  return { id, file, kind: check.kind, contentType: CONTENT_TYPES[ext] as string };
}

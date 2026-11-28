import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { FastifyBaseLogger } from 'fastify';

/**
 * The wasm build needs a one-time init; memoized per process. A second init
 * (test isolation reloads modules) answers "already initialized" and is fine.
 */
let wasmReady: Promise<void> | undefined;
function ensureWasm(): Promise<void> {
  if (wasmReady === undefined) {
    const require = createRequire(import.meta.url);
    wasmReady = readFile(require.resolve('@resvg/resvg-wasm/index_bg.wasm'))
      .then((bytes) => initWasm(bytes))
      .catch((error: unknown) => {
        if (!String(error).toLowerCase().includes('initialized')) {
          throw error;
        }
      });
  }
  return wasmReady;
}

/** Whitelist keeps the disk cache bounded; 64 covers 2–3× list tiles. */
export const RASTER_SIZES = [32, 64, 128] as const;
export const DEFAULT_RASTER_SIZE = 64;

const CACHE_DIR = '.cache';

export interface Rasterizer {
  /** PNG bytes for a scanned SVG icon file, rendered at size×size. */
  render(file: string, size: number): Promise<Buffer | undefined>;
}

/**
 * Rasterizes instance SVG icons for native clients (#103). Only files that
 * already passed the icon scan are ever rendered, and only at whitelisted
 * sizes. Results are cached in DATA_DIR/icons/.cache keyed by
 * file + mtime + size; stale rasters of the same source are deleted when a
 * new one is written. currentColor resolves to opaque black so mono icons
 * tint via the alpha channel (iOS template images), mirroring the web's
 * CSS-mask rendering.
 */
export function createRasterizer(dir: string, log: FastifyBaseLogger): Rasterizer {
  const cacheDir = join(dir, CACHE_DIR);

  return {
    async render(file, size) {
      let mtimeMs: number;
      try {
        mtimeMs = (await stat(join(dir, file))).mtimeMs;
      } catch {
        return undefined;
      }
      const cacheName = `${file}.${mtimeMs}.${size}.png`;
      try {
        return await readFile(join(cacheDir, cacheName));
      } catch {
        // Not cached yet.
      }

      let png: Buffer;
      try {
        await ensureWasm();
        const svg = await readFile(join(dir, file), 'utf8');
        const rendered = new Resvg(svg.replaceAll(/currentColor/gi, '#000000'), {
          fitTo: { mode: 'width', value: size },
        }).render();
        png = Buffer.from(rendered.asPng());
      } catch (error) {
        log.warn({ file, size, error }, 'icon raster failed');
        return undefined;
      }

      try {
        await mkdir(cacheDir, { recursive: true });
        for (const stale of await readdir(cacheDir)) {
          if (stale.startsWith(`${file}.`) && stale !== cacheName) {
            await unlink(join(cacheDir, stale)).catch(() => {});
          }
        }
        await writeFile(join(cacheDir, cacheName), png);
      } catch (error) {
        // Serving still works without the cache (e.g. read-only volume).
        log.warn({ file, error }, 'icon raster cache write failed');
      }
      return png;
    },
  };
}

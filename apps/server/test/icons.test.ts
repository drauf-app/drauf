import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkSvg, MAX_ICON_BYTES } from '../src/icons/sanitize.js';
import { createLocalUser } from '../src/users/service.js';
import { createTestApp, type TestApp } from './helpers.js';

const PASSWORD = 'correct-horse-battery';

const MONO_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path fill="#000" d="M0 0h1v1z"/></svg>';
const COLOR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><circle fill="#e11" stroke="black" r="4"/></svg>';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

interface Manifest {
  defaultPack: string;
  packs: Array<{ id: string; kind: string; source: string }>;
  icons: Array<{ id: string; kind: string; url: string }>;
}

describe('instance icons (#71)', () => {
  let dir: string;
  let ctx: TestApp;
  let user: { token: string };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'drauf-icons-'));
    ctx = await createTestApp({ iconsDir: dir });
    const created = await createLocalUser(ctx.database, {
      username: 'christian',
      password: PASSWORD,
      displayName: 'christian',
      isAdmin: true, // The pack test flips the icons.pack admin setting.
    });
    if (!created.ok) throw new Error('fixture user not created');
    const login = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'christian', password: PASSWORD },
    });
    user = { token: (login.json() as { accessToken: string }).accessToken };
  });

  afterEach(async () => {
    await ctx.close();
    await rm(dir, { recursive: true, force: true });
  });

  function getManifest(headers: Record<string, string> = {}) {
    return ctx.app.inject({
      method: 'GET',
      url: '/api/icons',
      headers: { authorization: `Bearer ${user.token}`, ...headers },
    });
  }

  it('lists volume icons with auto-detected kind and serves them', async () => {
    await writeFile(join(dir, 'spices.svg'), MONO_SVG);
    await writeFile(join(dir, 'tomato.svg'), COLOR_SVG);
    await writeFile(join(dir, 'herbs.png'), PNG);

    const manifest = (await getManifest()).json() as Manifest;
    expect(manifest.defaultPack).toBe('openmoji');
    expect(manifest.packs.map((pack) => pack.id)).toEqual(['openmoji', 'fluent', 'custom']);
    expect(manifest.icons).toEqual([
      { id: 'custom:herbs', kind: 'color', url: '/icons/custom/herbs.png' },
      { id: 'custom:spices', kind: 'mono', url: '/icons/custom/spices.svg' },
      { id: 'custom:tomato', kind: 'color', url: '/icons/custom/tomato.svg' },
    ]);

    // The files themselves are public (Bearer auth cannot ride on <img>).
    const served = await ctx.app.inject({ method: 'GET', url: '/icons/custom/spices.svg' });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/svg+xml');
    expect(served.headers['content-security-policy']).toContain('sandbox');
    expect(served.headers['content-disposition']).toBe('attachment');
    expect(served.body).toBe(MONO_SVG);
  });

  it('requires auth for the manifest but not for the files', async () => {
    await writeFile(join(dir, 'spices.svg'), MONO_SVG);
    const unauthenticated = await ctx.app.inject({ method: 'GET', url: '/api/icons' });
    expect(unauthenticated.statusCode).toBe(401);
    const file = await ctx.app.inject({ method: 'GET', url: '/icons/custom/spices.svg' });
    expect(file.statusCode).toBe(200);
  });

  it('keeps rejected and unknown files invisible to manifest and serving', async () => {
    await writeFile(
      join(dir, 'evil.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await writeFile(
      join(dir, 'handler.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path fill="#000"/></svg>',
    );
    await writeFile(
      join(dir, 'external.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://evil.example/x.svg#a"/></svg>',
    );
    await writeFile(join(dir, 'fake.png'), Buffer.from('not a png'));
    await writeFile(join(dir, 'big.svg'), `<svg>${'x'.repeat(MAX_ICON_BYTES)}</svg>`);
    await writeFile(join(dir, 'bad name!.svg'), MONO_SVG);
    await writeFile(join(dir, 'notes.txt'), 'not an icon');

    const manifest = (await getManifest()).json() as Manifest;
    expect(manifest.icons).toEqual([]);
    for (const url of ['/icons/custom/evil.svg', '/icons/custom/fake.png']) {
      const served = await ctx.app.inject({ method: 'GET', url });
      expect(served.statusCode).toBe(404);
    }
  });

  it('never serves paths outside the registry', async () => {
    await writeFile(join(dir, 'spices.svg'), MONO_SVG);
    for (const url of [
      '/icons/custom/..%2Fspices.svg',
      '/icons/custom/%2e%2e%2fdrauf.db',
      '/icons/custom/missing.svg',
    ]) {
      const served = await ctx.app.inject({ method: 'GET', url });
      expect(served.statusCode).toBe(404);
    }
  });

  it('answers unchanged manifests with 304 via ETag', async () => {
    await writeFile(join(dir, 'spices.svg'), MONO_SVG);
    const first = await getManifest();
    expect(first.statusCode).toBe(200);
    const etag = first.headers.etag as string;
    expect(etag).toBeTruthy();
    const second = await getManifest({ 'if-none-match': etag });
    expect(second.statusCode).toBe(304);
  });

  it('reflects the icons.pack setting as defaultPack, busting the ETag (#83)', async () => {
    const before = await getManifest();
    const etag = before.headers.etag as string;
    const switched = await ctx.app.inject({
      method: 'PUT',
      url: '/api/admin/settings',
      headers: { authorization: `Bearer ${user.token}` },
      payload: { key: 'icons.pack', value: 'fluent' },
    });
    expect(switched.statusCode).toBe(200);

    const after = await getManifest({ 'if-none-match': etag });
    expect(after.statusCode).toBe(200); // The old ETag no longer matches.
    expect((after.json() as Manifest).defaultPack).toBe('fluent');
  });
});

describe('svg sanitizer', () => {
  it('detects mono vs color including style attributes', () => {
    expect(checkSvg(MONO_SVG)).toEqual({ ok: true, kind: 'mono' });
    expect(checkSvg(COLOR_SVG)).toEqual({ ok: true, kind: 'color' });
    expect(checkSvg('<svg><path style="fill:none;stroke:currentColor" d="M0 0"/></svg>')).toEqual({
      ok: true,
      kind: 'mono',
    });
    expect(checkSvg('<svg><path style="fill:#ff0000" d="M0 0"/></svg>')).toEqual({
      ok: true,
      kind: 'color',
    });
  });

  it('accepts XML declarations, comments and fragment references', () => {
    const svg = '<?xml version="1.0"?><!-- hi --><svg><use href="#part"/><path fill="#000"/></svg>';
    expect(checkSvg(svg)).toEqual({ ok: true, kind: 'mono' });
  });

  it('rejects script vectors and external references', () => {
    const bad = [
      '<svg><script/></svg>',
      '<svg onload="x"></svg>',
      '<svg><a href="javascript:alert(1)">x</a></svg>',
      '<svg><foreignObject/></svg>',
      '<svg><image href="#x"/></svg>',
      '<!DOCTYPE svg []><svg/>',
      '<svg><style>@import url(evil)</style></svg>',
      '<svg><use xlink:href="https://evil.example/#x"/></svg>',
      '<svg><path style="fill:url(https://evil.example)"/></svg>',
      'plain text',
    ];
    for (const svg of bad) {
      expect(checkSvg(svg).ok, svg).toBe(false);
    }
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers.js';

describe('web app serving', () => {
  let dir: string;
  let ctx: TestApp;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'drauf-web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Drauf</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log("drauf");');
    ctx = await createTestApp({ webDir: dir });
  });

  afterAll(async () => {
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves index.html with security headers and no caching', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('Drauf');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src 'self';");
    // Inline styles are needed for dynamic values (list colours, print layout).
    expect(response.headers['content-security-policy']).toContain(
      "style-src 'self' 'unsafe-inline'",
    );
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('serves hashed assets as immutable', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('falls back to index.html for client-side routes', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/plan' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Drauf');
  });

  it('keeps JSON 404s on unknown API routes', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/does-not-exist' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('does not fall back for non-GET requests', async () => {
    const response = await ctx.app.inject({ method: 'POST', url: '/plan' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'not_found' });
  });

  it('leaves API routes working and uncached', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toBeUndefined();
  });
});

describe('without a built web app', () => {
  it('returns 404 at the root', async () => {
    const ctx = await createTestApp();
    const response = await ctx.app.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(404);
    await ctx.close();
  });
});

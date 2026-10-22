import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineModule } from '@devias/core';
import { defineModuleServer } from '@devias/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8"/></svg>';

describe('GET /api/modules/{moduleId}/logo', () => {
  let server: Server;
  let folder: string;
  const get = (path: string, headers: Record<string, string> = {}) => server.app.request(path, { headers });

  beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'devias-logo-route-'));
    mkdirSync(join(folder, 'assets'));
    writeFileSync(join(folder, 'assets', 'mark.svg'), SVG);
    writeFileSync(join(folder, 'secret.txt'), 'not a logo');
    const branded = {
      ...defineModuleServer(defineModule({ id: 'branded', version: '0.1.0', logo: './assets/mark.svg' })),
      directory: folder,
    };
    const ghost = {
      ...defineModuleServer(defineModule({ id: 'ghost', version: '0.1.0', logo: './assets/gone.svg' })),
      directory: folder,
    };
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      {
        modules: [
          branded,
          ghost,
          defineModuleServer(defineModule({ id: 'plain', version: '0.1.0' })),
          // Declares a logo but was not loaded from a package, so there is nowhere to read it from.
          defineModuleServer(defineModule({ id: 'inline', version: '0.1.0', logo: './logo.svg' })),
        ],
        pgliteDataDir: 'memory://',
      },
    );
  });
  afterAll(async () => {
    await server.close();
    rmSync(folder, { recursive: true, force: true });
  });

  it('serves the file with its type, with no session', async () => {
    const response = await get('/api/modules/branded/logo');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(await response.text()).toBe(SVG);
  });

  it('sends the headers that keep an svg harmless, and a cache that can be asked again', async () => {
    const response = await get('/api/modules/branded/logo');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(response.headers.get('cache-control')).toContain('no-cache');
    const etag = response.headers.get('etag');
    expect(etag).toMatch(/^"[0-9a-f]{40}"$/);
    const again = await get('/api/modules/branded/logo', { 'if-none-match': etag ?? '' });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    expect((await get('/api/modules/branded/logo', { 'if-none-match': '"other"' })).status).toBe(200);
  });

  it('is a 404 for an unknown module, a module with no logo, a missing file and a module with no folder', async () => {
    for (const id of ['nope', 'plain', 'ghost', 'inline']) {
      const response = await get(`/api/modules/${id}/logo`);
      expect(response.status, id).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
  });

  it('finds the file from the module, never from the request', async () => {
    for (const path of [
      '/api/modules/..%2Fsecret.txt/logo',
      '/api/modules/branded%2F..%2Fsecret.txt/logo',
      '/api/modules/branded/logo/../../secret.txt',
    ]) {
      const response = await get(path);
      expect(response.status, path).not.toBe(200);
    }
  });

  it('is in the API document', async () => {
    const document = (await (await get('/api/openapi.json')).json()) as { paths: Record<string, unknown> };
    expect(Object.keys(document.paths)).toContain('/api/modules/{moduleId}/logo');
  });
});

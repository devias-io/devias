import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadManifest } from '../src/load-manifest';

describe('loadManifest', () => {
  it('loads a TypeScript manifest module through tsx', async () => {
    const { manifest, dir } = await loadManifest(resolve(__dirname, '../../fixtures/src/contacts/index.ts'));
    expect(manifest.id).toBe('01a1751f-5f09-7114-9d75-ce42abd8a6ef');
    expect(manifest.objects.map((o) => o.nameSingular)).toContain('person');
    expect(dir.endsWith('/fixtures/src/contacts')).toBe(true);
  });

  it('loads and validates a JSON manifest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devias-cli-'));
    const path = join(dir, 'manifest.json');
    await writeFile(path, JSON.stringify({ id: 'json-ext', version: '1.2.3' }));
    const { manifest } = await loadManifest(path);
    expect(manifest.id).toBe('json-ext');
    expect(manifest.objects).toEqual([]);
    await writeFile(path, JSON.stringify({ id: 'json-ext', version: 'not-semver' }));
    await expect(loadManifest(path)).rejects.toThrow();
  });
});

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadModules } from '@devias/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** Throwaway packages in a folder of their own, found the way a real one is: through `node_modules`. */
describe('the logo of a module', () => {
  let root: string;
  let from: URL;

  const makePackage = (name: string, logo: string | undefined, files: Record<string, string | Buffer> = {}) => {
    const folder = join(root, 'node_modules', name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'package.json'),
      JSON.stringify({ name, version: '0.1.0', type: 'module', exports: { './manifest': './manifest.js' } }),
    );
    writeFileSync(
      join(folder, 'manifest.js'),
      `export const manifest = ${JSON.stringify({
        id: name,
        version: '0.1.0',
        name,
        ...(logo ? { logo } : {}),
        actions: [],
        connections: [],
        events: [],
      })};`,
    );

    for (const [file, content] of Object.entries(files)) {
      mkdirSync(join(folder, file, '..'), { recursive: true });
      writeFileSync(join(folder, file), content);
    }

    return folder;
  };
  const load = (name: string) => loadModules({ modules: [name] }, { from });

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'devias-logo-'));
    writeFileSync(join(root, 'index.js'), '');
    from = pathToFileURL(join(root, 'index.js'));
    // The studio's own module is always loaded first, so this folder has to find it the way it finds the others.
    mkdirSync(join(root, 'node_modules', '@devias'), { recursive: true });
    symlinkSync(
      fileURLToPath(new URL('../../../packages/studio', import.meta.url)),
      join(root, 'node_modules', '@devias', 'studio'),
      'dir',
    );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('is found in the package, which the module remembers', async () => {
    makePackage('with-logo', './logo.svg', { 'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>' });
    const modules = await load('with-logo');
    const loaded = modules.find((module) => module.manifest.id === 'with-logo');
    expect(loaded?.manifest.logo).toBe('./logo.svg');
    expect(loaded?.directory).toContain('with-logo');
  });

  it('may be left out', async () => {
    makePackage('no-logo', undefined);
    const loaded = (await load('no-logo')).find((module) => module.manifest.id === 'no-logo');
    expect(loaded?.manifest.logo).toBeUndefined();
    expect(loaded?.directory).toBeDefined();
  });

  it('must exist, and the error names the module', async () => {
    makePackage('missing-logo', './nope.svg');
    await expect(load('missing-logo')).rejects.toThrow(
      'Module "missing-logo": its logo "./nope.svg" is not in its package',
    );
  });

  it('must be small', async () => {
    makePackage('huge-logo', './logo.png', { 'logo.png': Buffer.alloc(300 * 1024) });
    await expect(load('huge-logo')).rejects.toThrow(/its logo "\.\/logo\.png" is 300 KB: at most 256 KB/);
  });

  it('must not lead out of the package, even through a link', async () => {
    const outside = join(root, 'outside.svg');
    writeFileSync(outside, '<svg/>');
    const folder = makePackage('linked-logo', './logo.svg');
    symlinkSync(outside, join(folder, 'logo.svg'));
    await expect(load('linked-logo')).rejects.toThrow('leads out of its package');
  });

  it('must be a file', async () => {
    const folder = makePackage('folder-logo', './logo.svg');
    mkdirSync(join(folder, 'logo.svg'));
    await expect(load('folder-logo')).rejects.toThrow('is not a file');
  });
});

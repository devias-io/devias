import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ModuleManifest, parseManifest } from '@devias/core';

/**
 * Load a manifest from a `.json` file or from a TypeScript/JavaScript module that exports
 * `manifest` (or a default export). TypeScript is imported through tsx.
 */
export const loadManifest = async (path: string): Promise<{ manifest: ModuleManifest; dir: string }> => {
  const absolute = resolve(process.cwd(), path);
  const dir = dirname(absolute);

  if (absolute.endsWith('.json')) {
    const json = JSON.parse(await readFile(absolute, 'utf8'));

    return { manifest: parseManifest(json), dir };
  }

  const { tsImport } = await import('tsx/esm/api');
  const cacheBuster = `?t=${Date.now()}`;
  const mod = (await tsImport(`${pathToFileURL(absolute).href}${cacheBuster}`, import.meta.url)) as Record<
    string,
    unknown
  >;
  const candidate = mod.manifest ?? mod.default;

  if (!candidate) {
    throw new Error(`${path} exports neither "manifest" nor a default export`);
  }

  return { manifest: parseManifest(candidate), dir };
};

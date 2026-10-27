import { existsSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type DeviasConfig,
  MODULE_LOGO_MAX_BYTES,
  manifestFrom,
  modulePackageOf,
  pickModuleExport,
} from '@devias/core';
import { defineModuleServer, type ModuleServer } from './index';

/** The studio's own module: always registered, always first, never listed in `devias.config.ts`. */
const STUDIO_PACKAGE = '@devias/studio';

const isModuleServer = (value: unknown): value is ModuleServer =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as ModuleServer).manifest?.id === 'string' &&
  Array.isArray((value as ModuleServer).actions);

/** The file `specifier` resolves to, or undefined when the package does not export that path. */
const resolveExport = (require: NodeRequire, specifier: string): string | undefined => {
  try {
    return require.resolve(specifier);
  } catch (error) {
    const code = (error as { code?: string }).code;

    if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || code === 'MODULE_NOT_FOUND') {
      return undefined;
    }

    throw error;
  }
};

/** The folder of the package a file belongs to: the nearest one up with a `package.json`. */
const packageRootOf = (file: string): string => {
  let folder = dirname(file);

  while (!existsSync(join(folder, 'package.json')) && dirname(folder) !== folder) {
    folder = dirname(folder);
  }

  return folder;
};

/**
 * The file of a module's logo inside its package, or an error that names the module: the file must exist, be a plain
 * file inside the package (a link out of it does not count) and be small.
 */
export const logoFileOf = (moduleId: string, directory: string, path: string): string => {
  const fail = (reason: string) => new Error(`Module "${moduleId}": its logo "${path}" ${reason}`);
  const file = resolve(directory, path);

  if (!existsSync(file)) {
    throw fail('is not in its package');
  }

  const root = realpathSync(directory);
  const real = realpathSync(file);

  const inside = relative(root, real);

  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw fail('leads out of its package');
  }

  const stat = statSync(real);

  if (!stat.isFile()) {
    throw fail('is not a file');
  }

  if (stat.size > MODULE_LOGO_MAX_BYTES) {
    throw fail(`is ${Math.ceil(stat.size / 1024)} KB: at most ${MODULE_LOGO_MAX_BYTES / 1024} KB`);
  }

  return real;
};

/** The module with the folder it was loaded from, its logo checked. */
const withDirectory = (server: ModuleServer, file: string): ModuleServer => {
  const directory = packageRootOf(file);

  if (server.manifest.logo) {
    logoFileOf(server.manifest.id, directory, server.manifest.logo);
  }

  return { ...server, directory };
};

const importFile = async (file: string) => (await import(pathToFileURL(file).href)) as Record<string, unknown>;

/**
 * The server side of every module in `devias.config.ts`, the studio's own first. A package's `./server` export is
 * loaded when it has one; a module without server code (only `./manifest`) is registered with an empty server side,
 * which still makes it installable.
 *
 * `from` is where packages are resolved from: pass `import.meta.url` of the caller.
 */
export const loadModules = async (config: DeviasConfig, options: { from: string | URL }): Promise<ModuleServer[]> => {
  const require = createRequire(options.from);
  const packages = [STUDIO_PACKAGE, ...config.modules.map(modulePackageOf)];
  const loaded: ModuleServer[] = [];

  for (const pkg of packages) {
    const server = resolveExport(require, `${pkg}/server`);

    if (server) {
      loaded.push(withDirectory(pickModuleExport(await importFile(server), isModuleServer, `"${pkg}/server"`), server));
      continue;
    }

    const manifest = resolveExport(require, `${pkg}/manifest`);

    if (!manifest) {
      throw new Error(
        `devias.config.ts lists "${pkg}", which cannot be found or exports neither "./server" nor "./manifest". ` +
          `Add it to the root package.json (pnpm add -w ${pkg}) and check its "exports".`,
      );
    }

    loaded.push(withDirectory(defineModuleServer(manifestFrom(await importFile(manifest), pkg)), manifest));
  }

  return loaded;
};

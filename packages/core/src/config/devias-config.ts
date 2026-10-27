import type { ModuleManifest } from '../manifest/manifest';
import type { ModuleStudio } from './define';

/**
 * One module of an install: its package name, or the name with options for its studio side
 * (`{ package: '@acme/mod-recruiting', options: { currency: 'EUR' } }`). Options must be plain data.
 */
export type ModuleEntry = string | { package: string; options?: unknown };

/**
 * `devias.config.ts`: the modules this install ships with, in order. The studio (through the `devias()` Vite
 * plugin) and the server (through `loadModules`) both read it, so a module is added in one place. The studio's own
 * module is always first and is not listed.
 *
 * A module is a package that exports `./manifest`, and optionally `./studio` (its UI) and `./server` (its routes,
 * actions and webhooks). Listing it here makes it available; each workspace installs it from Settings → Modules,
 * unless its manifest is `core`.
 */
export interface DeviasConfig {
  modules: ModuleEntry[];
}

export const modulePackageOf = (entry: ModuleEntry): string => (typeof entry === 'string' ? entry : entry.package);

export const moduleOptionsOf = (entry: ModuleEntry): unknown => (typeof entry === 'string' ? undefined : entry.options);

const isManifest = (value: unknown): value is ModuleManifest =>
  typeof value === 'object' && value !== null && typeof (value as ModuleManifest).id === 'string' && 'version' in value;

const isModuleStudio = (value: unknown): value is ModuleStudio<unknown> =>
  typeof value === 'function' && isManifest((value as ModuleStudio<unknown>).manifest);

/**
 * The one export of an entry point that matches: its default export, else its only matching named export. Module
 * packages export the module as default; a single named export works too.
 */
export const pickModuleExport = <T>(
  exports: Record<string, unknown>,
  matches: (value: unknown) => value is T,
  where: string,
): T => {
  if (matches(exports.default)) {
    return exports.default;
  }

  const named = Object.values(exports).filter(matches);

  if (named.length === 1) {
    return named[0] as T;
  }

  throw new Error(
    named.length === 0
      ? `${where} exports no module: export it as default`
      : `${where} exports ${named.length} modules: export the one to load as default`,
  );
};

/** The studio side exported by `<package>/studio`. */
export const studioModuleFrom = (exports: Record<string, unknown>, pkg: string): ModuleStudio<unknown> =>
  pickModuleExport(exports, isModuleStudio, `"${pkg}/studio"`);

/** The manifest exported by `<package>/manifest` (as `manifest`, or as the default export). */
export const manifestFrom = (exports: Record<string, unknown>, pkg: string): ModuleManifest => {
  if (isManifest(exports.manifest)) {
    return exports.manifest;
  }

  return pickModuleExport(exports, isManifest, `"${pkg}/manifest"`);
};

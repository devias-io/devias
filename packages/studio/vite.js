// Plain JavaScript on purpose: Vite loads its plugins with Node, without compiling them.
import { createRequire } from 'node:module';
import path from 'node:path';

const VIRTUAL_ID = 'virtual:devias/modules';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/** @param {import('@devias/core').ModuleEntry} entry */
const packageOf = (entry) => (typeof entry === 'string' ? entry : entry.package);
/** @param {import('@devias/core').ModuleEntry} entry */
const optionsOf = (entry) => (typeof entry === 'string' ? undefined : entry.options);

/** Whether `specifier` resolves from `root`: false when the package does not export that path. */
const exportsPath = (require, specifier) => {
  try {
    require.resolve(specifier);
    return true;
  } catch (error) {
    const code = /** @type {{ code?: string }} */ (error).code;
    if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || code === 'MODULE_NOT_FOUND') {
      return false;
    }
    throw error;
  }
};

/**
 * Generates `virtual:devias/modules` from `devias.config.ts`: the studio side of every listed module (the studio's
 * own first) and every module's manifest, server-only ones included, for the mock backend.
 *
 * @param {import('@devias/core').DeviasConfig} config
 * @param {string} root
 */
const generate = (config, root) => {
  const require = createRequire(path.join(root, 'package.json'));
  const imports = [
    "import { manifestFrom, studioModuleFrom } from '@devias/core';",
    "import { studio as __studio } from '@devias/studio';",
  ];
  const modules = ['__studio()'];
  const manifests = ['__studio.manifest'];
  config.modules.forEach((entry, index) => {
    const pkg = packageOf(entry);
    const name = `__m${index}`;
    const quoted = JSON.stringify(pkg);
    if (exportsPath(require, `${pkg}/studio`)) {
      imports.push(`import * as ${name}x from ${JSON.stringify(`${pkg}/studio`)};`);
      imports.push(`const ${name} = studioModuleFrom(${name}x, ${quoted});`);
      const options = optionsOf(entry);
      modules.push(options === undefined ? `${name}()` : `${name}(${JSON.stringify(options)})`);
      manifests.push(`${name}.manifest`);
    } else if (exportsPath(require, `${pkg}/manifest`)) {
      // A server-only module: nothing to render, but the mock backend still offers it.
      imports.push(`import * as ${name}x from ${JSON.stringify(`${pkg}/manifest`)};`);
      manifests.push(`manifestFrom(${name}x, ${quoted})`);
    } else {
      throw new Error(
        `devias.config.ts lists "${pkg}", which cannot be found or exports neither "./studio" nor "./manifest". ` +
          `Add it to the root package.json (pnpm add -w ${pkg}) and check its "exports".`,
      );
    }
  });
  return [
    ...imports,
    '',
    `export const modules = [${modules.join(', ')}];`,
    `export const manifests = [${manifests.join(', ')}];`,
    '',
  ].join('\n');
};

/**
 * The studio's Vite plugin: reads the modules from `devias.config.ts` and provides them as
 * `import { modules, manifests } from 'virtual:devias/modules'`.
 *
 * @param {import('@devias/core').DeviasConfig} config
 * @returns {import('vite').Plugin}
 */
export const devias = (config) => {
  let root = process.cwd();
  return {
    name: 'devias:modules',
    configResolved(resolved) {
      root = resolved.root;
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id) {
      return id === RESOLVED_ID ? generate(config, root) : undefined;
    },
  };
};

export default devias;

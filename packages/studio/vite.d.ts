import type { DeviasConfig } from '@devias/core';
import type { Plugin } from 'vite';

/**
 * The studio's Vite plugin: reads the modules from `devias.config.ts` and provides them as
 * `import { modules, manifests } from 'virtual:devias/modules'`.
 */
export declare const devias: (config: DeviasConfig) => Plugin;
export default devias;

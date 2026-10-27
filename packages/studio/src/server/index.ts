import { defineModuleServer } from '@devias/server';
import { manifest } from '../manifest';

/** The studio module's server side: nothing to run, but registering it installs the module in every workspace. */
export const studio = defineModuleServer(manifest);

export { manifest };

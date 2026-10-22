import { defineModuleServer } from '@devias/server';
import { manifest } from '../manifest';
import { recalculateQuote } from './recalculate-quote';

/**
 * Server side of the quotes module: one action (recalculate a quote). Everything else it offers (its objects, views
 * and records) the API, workflows and the agent reach through core's actions. Runs inside the API server; loaded
 * through `@devias/mod-quotes/server`.
 */
export const quotes = defineModuleServer(manifest, { actions: [recalculateQuote] });

export default quotes;

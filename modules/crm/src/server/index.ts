import { defineModuleServer } from '@devias/server';
import { manifest } from '../manifest';

/**
 * Server side of the built-in CRM: a tiny HTTP surface. Everything else it offers (its objects, views and records)
 * the API, workflows and the agent reach through core's actions. Runs inside the API server; loaded through
 * `@devias/mod-crm/server`.
 */
export const crm = defineModuleServer(manifest, {
  routes: (router) => {
    router.get('/health', (c) => c.json({ ok: true, module: 'crm' }));
  },
});

export default crm;

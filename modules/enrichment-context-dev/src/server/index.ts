import { defineConnectionHandler, defineModuleServer } from '@devias/server';
import { ids, manifest } from '../manifest';
import { enrichPerson } from './actions/enrich-person';
import { testConnection } from './connection-test';

/**
 * Server side of the Context.dev enrichment: its action and its connection test. Loaded through
 * `@devias/mod-enrichment-context-dev/server`.
 */
export const server = defineModuleServer(manifest, {
  actions: [enrichPerson],
  connections: [defineConnectionHandler({ id: ids.connections.default, test: testConnection })],
});

export default server;

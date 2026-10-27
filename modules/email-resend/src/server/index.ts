import { defineConnectionHandler, defineModuleServer } from '@devias/server';
import { ids, manifest } from '../manifest';
import { sendEmail } from './actions/send-email';
import { testConnection } from './connection-test';
import { webhook } from './webhook/parse';

/**
 * Server side of the Resend email provider: its action, connection test and webhook. Loaded through
 * `@devias/mod-email-resend/server`.
 */
export const server = defineModuleServer(manifest, {
  actions: [sendEmail],
  connections: [defineConnectionHandler({ id: ids.connections.default, test: testConnection })],
  webhook,
});

export default server;

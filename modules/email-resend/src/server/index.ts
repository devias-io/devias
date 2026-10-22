import { defineModuleServer } from '@devias/server';
import { manifest } from '../manifest';
import { sendEmail } from './actions/send-email';
import { testResend } from './connection-test';
import { resendWebhook } from './webhook/parse';

/**
 * Server side of the Resend email provider: its action, connection test and webhook. Loaded through
 * `@devias/mod-email-resend/server`.
 */
export const emailResend = defineModuleServer(manifest, {
  actions: [sendEmail],
  connections: { default: { test: testResend } },
  webhook: resendWebhook,
});

export default emailResend;

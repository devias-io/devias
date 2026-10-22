import { defineModule } from '@devias/core';
import { actions } from './actions';
import { connections } from './connections';
import { RESEND_EVENTS } from './events';
import { policies } from './policies';

/**
 * Pure manifest: Resend as an email provider, named `email-<service>` as payment providers are `payment-<service>`.
 * The API key a workspace connects Resend, the action that sends an email, and the delivery events Resend's webhook
 * reports. The server side (`./server`) implements them.
 */
export const manifest = defineModule({
  id: 'email-resend',
  version: '0.1.0',
  name: 'Email via Resend',
  description: 'Send transactional email from workflows and react to deliveries, bounces and opens.',
  icon: 'mail',
  logo: './logo.svg',
  website: 'https://resend.com',
  publisher: { id: 'devias', name: 'Devias', url: 'https://devias.io' },
  policies,
  connections,
  actions,
  events: RESEND_EVENTS,
  webhookHelp:
    'In Resend → Webhooks, add this URL, pick the events you want, then paste the signing secret into the connection.',
});

export { RESEND_EVENTS } from './events';
export { ids } from './ids';

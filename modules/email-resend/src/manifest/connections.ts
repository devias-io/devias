import { defineConnection } from '@devias/core';
import { ids } from './ids';

/** The workspace's Resend account: an API key, and the secret that signs the webhook's events. */
export const connections = [
  defineConnection({
    id: ids.connections.default,
    kind: 'api_key',
    label: 'Resend',
    fields: [
      {
        name: 'api_key',
        label: 'API key',
        placeholder: 're_…',
        help: 'From Resend → API Keys. A key with sending access is enough.',
      },
      {
        name: 'webhook_secret',
        label: 'Webhook signing secret',
        required: false,
        placeholder: 'whsec_…',
        help: 'Shown when you add the webhook URL under Resend → Webhooks. Needed for event triggers only.',
      },
    ],
  }),
];

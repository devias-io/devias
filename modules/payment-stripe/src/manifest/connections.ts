import { defineConnection } from '@devias/core';
import { ids } from './ids';

/** The workspace's Stripe account: a secret key, and the secret that signs the webhook's events. */
export const connections = [
  defineConnection({
    id: ids.connections.default,
    kind: 'api_key',
    label: 'Stripe',
    fields: [
      {
        name: 'secret_key',
        label: 'Secret key',
        placeholder: 'sk_test_… or sk_live_…',
        help: 'From Stripe → Developers → API keys. A restricted key with Prices and Payment Links write access works too.',
      },
      {
        name: 'webhook_secret',
        label: 'Webhook signing secret',
        required: false,
        placeholder: 'whsec_…',
        help: 'Shown when you add the endpoint under Stripe → Developers → Webhooks. Needed to record payments.',
      },
    ],
  }),
];

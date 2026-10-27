import { defineEvent, defineModule } from '@devias/core';

/**
 * Pure manifest: the API key a workspace connects with to connect Mailer, the action that sends an email, and the
 * delivery events Mailer's webhook reports. The server side (`./server`) implements them.
 */

export const MAILER_EVENTS = [
  defineEvent({
    id: '01a17526-8e0a-75e3-a5e9-ee98bee27943',
    name: 'email.sent',
    description: 'The API accepted the email.',
  }),
  defineEvent({
    id: '01a1751f-5f0a-70f6-b258-876f6f0ccdaf',
    name: 'email.delivered',
    description: 'The receiving server accepted it.',
  }),
  defineEvent({
    id: '01a17526-8e0a-75e3-a5e9-f2c06b0e77dc',
    name: 'email.delivery_delayed',
    description: 'Delivery is being retried.',
  }),
  defineEvent({
    id: '01a1751f-5f0a-70f6-b258-8b7f3d3a2e36',
    name: 'email.bounced',
    description: 'The receiving server rejected it.',
  }),
  defineEvent({
    id: '01a17526-8e0a-75e3-a5e9-f519de326b50',
    name: 'email.complained',
    description: 'The recipient marked it as spam.',
  }),
  defineEvent({
    id: '01a17526-8e0a-75e3-a5e9-f95f02912ecb',
    name: 'email.opened',
    description: 'The recipient opened it (open tracking).',
  }),
  defineEvent({
    id: '01a17526-8e0a-75e3-a5e9-fc7784078399',
    name: 'email.clicked',
    description: 'The recipient clicked a link (click tracking).',
  }),
];

export const mailerManifest = defineModule({
  id: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
  version: '0.1.0',
  label: 'Mailer',
  description: 'Send transactional email from workflows and react to deliveries, bounces and opens.',
  icon: 'mail',
  website: 'https://mailer.com',
  connections: [
    {
      id: '01a1751f-5f0a-70f6-b258-7fe4ff716b07',
      kind: 'api_key',
      fields: [
        {
          name: 'api_key',
          label: 'API key',
          placeholder: 're_…',
          help: 'From Mailer → API Keys. A key with sending access is enough.',
        },
        {
          name: 'webhook_secret',
          label: 'Webhook signing secret',
          required: false,
          placeholder: 'whsec_…',
          help: 'Shown when you add the webhook URL under Mailer → Webhooks. Needed for event triggers only.',
        },
      ],
    },
  ],
  actions: [
    {
      id: '01a1751f-5f0a-70f6-b258-808951d74c84',
      name: 'send_email',
      label: 'Send an email',
      description: 'Send a transactional email from a verified domain.',
      input: [
        {
          name: 'from',
          label: 'From',
          required: true,
          placeholder: 'Acme <hello@acme.com>',
          help: 'A verified domain.',
        },
        { name: 'to', label: 'To', required: true, placeholder: '{{record.email}}', help: 'Comma-separate several.' },
        { name: 'subject', label: 'Subject', required: true },
        { name: 'html', label: 'HTML body', type: 'long_text' },
        { name: 'text', label: 'Text body', type: 'long_text', help: 'Used when there is no HTML body.' },
        { name: 'reply_to', label: 'Reply to' },
        { name: 'cc', label: 'Cc' },
        { name: 'bcc', label: 'Bcc' },
      ],
      output: [{ name: 'id', description: 'The email id, which the webhook events refer to as email_id.' }],
    },
  ],
  events: MAILER_EVENTS,
  webhookHelp:
    'In Mailer → Webhooks, add this URL, pick the events you want, then paste the signing secret into the connection.',
});

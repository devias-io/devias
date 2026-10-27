import { defineAction } from '@devias/core';
import { ids } from './ids';

/** The action workflows, the API and the agent can call; `../server` implements it. */
export const actions = [
  defineAction({
    id: ids.actions.send_email,
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
  }),
];

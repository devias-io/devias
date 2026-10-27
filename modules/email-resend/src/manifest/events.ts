import { defineEvent } from '@devias/core';
import { ids } from './ids';

/** The delivery events Resend's webhook reports, which workflows can start from. */
export const RESEND_EVENTS = [
  defineEvent({
    id: ids.events['email.sent'],
    name: 'email.sent',
    description: 'The API accepted the email.',
  }),
  defineEvent({
    id: ids.events['email.delivered'],
    name: 'email.delivered',
    description: 'The receiving server accepted it.',
  }),
  defineEvent({
    id: ids.events['email.delivery_delayed'],
    name: 'email.delivery_delayed',
    description: 'Delivery is being retried.',
  }),
  defineEvent({
    id: ids.events['email.bounced'],
    name: 'email.bounced',
    description: 'The receiving server rejected it.',
  }),
  defineEvent({
    id: ids.events['email.complained'],
    name: 'email.complained',
    description: 'The recipient marked it as spam.',
  }),
  defineEvent({
    id: ids.events['email.opened'],
    name: 'email.opened',
    description: 'The recipient opened it (open tracking).',
  }),
  defineEvent({
    id: ids.events['email.clicked'],
    name: 'email.clicked',
    description: 'The recipient clicked a link (click tracking).',
  }),
];

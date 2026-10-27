import { defineEvent } from '@devias/core';
import { ids } from './ids';

/** The payment events Stripe's webhook delivers, which workflows can start from. */
export const STRIPE_EVENTS = [
  defineEvent({
    id: ids.events['checkout.session.completed'],
    name: 'checkout.session.completed',
    description: 'A payment link purchase completed.',
  }),
  defineEvent({
    id: ids.events['checkout.session.async_payment_succeeded'],
    name: 'checkout.session.async_payment_succeeded',
    description: 'A purchase paid by a slower method (a bank debit) went through.',
  }),
  defineEvent({
    id: ids.events['checkout.session.async_payment_failed'],
    name: 'checkout.session.async_payment_failed',
    description: 'A purchase paid by a slower method failed.',
  }),
  defineEvent({
    id: ids.events['payment_intent.succeeded'],
    name: 'payment_intent.succeeded',
    description: 'A payment succeeded.',
  }),
  defineEvent({
    id: ids.events['payment_intent.payment_failed'],
    name: 'payment_intent.payment_failed',
    description: 'A payment failed.',
  }),
  defineEvent({
    id: ids.events['charge.refunded'],
    name: 'charge.refunded',
    description: 'A payment was refunded.',
  }),
];

/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  actions: {
    create_invoice_payment_link: 'payment-stripe.create_invoice_payment_link',
  },
  connections: {
    default: 'payment-stripe.default',
  },
  events: {
    'checkout.session.completed': 'payment-stripe.checkout.session.completed',
    'checkout.session.async_payment_succeeded': 'payment-stripe.checkout.session.async_payment_succeeded',
    'checkout.session.async_payment_failed': 'payment-stripe.checkout.session.async_payment_failed',
    'payment_intent.succeeded': 'payment-stripe.payment_intent.succeeded',
    'payment_intent.payment_failed': 'payment-stripe.payment_intent.payment_failed',
    'charge.refunded': 'payment-stripe.charge.refunded',
  },
} as const;

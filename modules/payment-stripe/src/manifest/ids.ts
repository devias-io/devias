/** Every id the module owns, its own included, written once; the manifest and the module's code point at them. */
export const ids = {
  module: '01a173cd-7d37-7041-9060-5201430b1059',
  actions: {
    create_invoice_payment_link: '01a17356-5c6d-765a-82b1-6ed47fadd713',
    handle_checkout_event: '01a17e4f-f34c-717f-b7e3-70f69914a3fa',
  },
  workflows: {
    apply_checkout_payments: '01a17e4f-f34c-717f-b7e3-76a556b1064d',
  },
  steps: {
    handle_checkout_event: '01a17e4f-f34c-717f-b7e3-78c3d0d7f68d',
  },
  connections: {
    default: '01a17356-5c6d-765a-82b1-7059adae69be',
  },
  events: {
    'checkout.session.completed': '01a17356-5c6d-765a-82b1-774748b8d75a',
    'checkout.session.async_payment_succeeded': '01a17356-5c6d-765a-82b1-7a5786c6b4f2',
    'checkout.session.async_payment_failed': '01a17356-5c6d-765a-82b1-7c5ea7d87337',
    'payment_intent.succeeded': '01a17356-5c6d-765a-82b1-83ff967c8c0d',
    'payment_intent.payment_failed': '01a17356-5c6d-765a-82b1-84b3f4bba457',
    'charge.refunded': '01a17356-5c6d-765a-82b1-8979b9393995',
  },
} as const;

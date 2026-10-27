/** Every id the module owns, its own included, written once; the manifest and the module's code point at them. */
export const ids = {
  module: '01a173cd-7d37-7041-9060-55d4bb9b036b',
  actions: {
    send_email: '01a17356-5c6b-77b4-903d-a1b772886720',
  },
  connections: {
    default: '01a17356-5c6b-77b4-903d-a742003c2443',
  },
  events: {
    'email.sent': '01a17356-5c6b-77b4-903d-a8e79f7e68de',
    'email.delivered': '01a17356-5c6b-77b4-903d-ae20298df72f',
    'email.delivery_delayed': '01a17356-5c6b-77b4-903d-b2e0bbb4b0f7',
    'email.bounced': '01a17356-5c6b-77b4-903d-b68e81cc322a',
    'email.complained': '01a17356-5c6b-77b4-903d-ba437e7c4e47',
    'email.opened': '01a17356-5c6b-77b4-903d-bf1388031402',
    'email.clicked': '01a17356-5c6b-77b4-903d-c0cf753433ca',
  },
  policies: {
    send_email: '01a17356-5c6b-77b4-903d-c454a78a6923',
  },
} as const;

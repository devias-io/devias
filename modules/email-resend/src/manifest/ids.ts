/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  actions: {
    send_email: 'email-resend.send_email',
  },
  connections: {
    default: 'email-resend.default',
  },
  events: {
    'email.sent': 'email-resend.email.sent',
    'email.delivered': 'email-resend.email.delivered',
    'email.delivery_delayed': 'email-resend.email.delivery_delayed',
    'email.bounced': 'email-resend.email.bounced',
    'email.complained': 'email-resend.email.complained',
    'email.opened': 'email-resend.email.opened',
    'email.clicked': 'email-resend.email.clicked',
  },
  policies: {
    send_email: 'email-resend.send_email',
  },
} as const;

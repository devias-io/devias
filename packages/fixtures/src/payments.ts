import { defineEvent, defineModule } from '@devias/core';

/**
 * Pure manifest: the API key a workspace connects with to connect Payments, the actions workflows and the agent can
 * call, and the billing events Payments's webhook delivers. The server side (`./server`) implements them.
 */

export const PAYMENT_EVENTS = [
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-6cca4f55cc82',
    name: 'customer.created',
    description: 'A customer was created.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-726e8fd4e871',
    name: 'customer.updated',
    description: 'A customer changed.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-752b37f0fedd',
    name: 'customer.deleted',
    description: 'A customer was deleted.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-781c513131e4',
    name: 'checkout.session.completed',
    description: 'A Checkout or payment link purchase completed.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-7cb65da2013f',
    name: 'payment_intent.succeeded',
    description: 'A payment succeeded.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-838c04ed7cc2',
    name: 'payment_intent.payment_failed',
    description: 'A payment failed.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-8486db6bce4e',
    name: 'invoice.paid',
    description: 'An invoice was paid.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-88706d5408c7',
    name: 'invoice.payment_failed',
    description: 'An invoice payment failed.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-8e2cbf0588de',
    name: 'charge.refunded',
    description: 'A charge was refunded.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-91106b21fc92',
    name: 'customer.subscription.created',
    description: 'A subscription started.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-94d79863d87d',
    name: 'customer.subscription.updated',
    description: 'A subscription changed.',
  }),
  defineEvent({
    id: '01a17526-8e0b-7285-ae71-9a9d2be0a932',
    name: 'customer.subscription.deleted',
    description: 'A subscription ended.',
  }),
];

export const paymentsManifest = defineModule({
  id: '01a1751f-5f15-7708-9f78-5224e878aec0',
  version: '0.1.0',
  label: 'Payments',
  description: 'Create customers and payment links from workflows and react to payments, invoices and subscriptions.',
  icon: 'credit-card',
  website: 'https://payments.example',
  connections: [
    {
      id: '01a1751f-5f15-7708-9f78-479d86b3b1ec',
      kind: 'api_key',
      fields: [
        {
          name: 'secret_key',
          label: 'Secret key',
          placeholder: 'sk_test_… or sk_live_…',
          help: 'From Payments → Developers → API keys. A restricted key with Customers and Payment Links write access works too.',
        },
        {
          name: 'webhook_secret',
          label: 'Webhook signing secret',
          required: false,
          placeholder: 'whsec_…',
          help: 'Shown when you add the endpoint under Payments → Developers → Webhooks. Needed for event triggers only.',
        },
      ],
    },
  ],
  actions: [
    {
      id: '01a17522-1eb5-70d0-a2fb-dc7bdf9fd917',
      name: 'create_customer',
      label: 'Create a customer',
      description: 'Create a Payments customer for a person or company.',
      input: [
        { name: 'email', label: 'Email', type: 'email', required: true, placeholder: '{{record.email}}' },
        { name: 'name', label: 'Name', placeholder: '{{record.first_name}} {{record.last_name}}' },
        { name: 'description', label: 'Description' },
        { name: 'phone', label: 'Phone' },
        {
          name: 'metadata',
          label: 'Metadata',
          type: 'json',
          help: 'Key/value pairs stored on the customer, e.g. {"recordId": "{{record.id}}"}.',
        },
      ],
      output: [
        { name: 'id', description: 'The new customer; use {{steps.<id>.id}} in later steps.' },
        { name: 'email', description: "The customer's email." },
        { name: 'name', description: "The customer's name." },
      ],
    },
    {
      id: '01a17526-8e0b-7285-ae71-9ca0283ba192',
      name: 'find_customer',
      label: 'Find a customer',
      description: 'Look a customer up by email; returns the most recent match, if any.',
      input: [{ name: 'email', label: 'Email', type: 'email', required: true, placeholder: '{{record.email}}' }],
      output: [
        { name: 'found', type: 'boolean', description: 'False, and the rest null, when no customer has that email.' },
        { name: 'id', description: 'The customer.' },
        { name: 'email', description: "The customer's email." },
        { name: 'name', description: "The customer's name." },
      ],
    },
    {
      id: '01a17526-8e0b-7285-ae71-a328239c30af',
      name: 'create_payment_link',
      label: 'Create a payment link',
      description: 'Create a shareable payment link for a price.',
      input: [
        {
          name: 'price',
          label: 'Price id',
          required: true,
          placeholder: 'price_…',
          help: 'From the product in Payments.',
        },
        { name: 'quantity', label: 'Quantity', type: 'number', placeholder: '1' },
        {
          name: 'metadata',
          label: 'Metadata',
          type: 'json',
          help: 'Key/value pairs stored on the link and its payments.',
        },
      ],
      output: [
        { name: 'id', description: 'The payment link.' },
        { name: 'url', description: 'Where it leads; put {{steps.<id>.url}} in an email or on the record.' },
      ],
    },
  ],
  events: PAYMENT_EVENTS,
  webhookHelp:
    'In Payments → Developers → Webhooks, add an endpoint with this URL, choose the events, then paste the signing secret into the connection.',
});

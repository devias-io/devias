/** Every id the module owns, its own included, written once; the manifest and the module's code point at them. */
export const ids = {
  module: '01a173cd-7d37-7041-9060-47af0d9faa3a',
  objects: {
    invoice: '01a17356-5c6c-76d4-aa86-978b865606c1',
    invoice_line: '01a17356-5c6c-76d4-aa86-9b883fa26f0d',
    payment: '01a17356-5c6c-76d4-aa86-9ed6e20902ff',
  },
  fields: {
    invoice: {
      number: '01a17356-5c6c-76d4-aa86-a3cd3149c450',
      status: '01a17356-5c6c-76d4-aa86-a6c2e32ad42d',
      company: '01a17356-5c6c-76d4-aa86-a8ada77bd9b4',
      contact: '01a17356-5c6c-76d4-aa86-ae5635119d6c',
      deal: '01a17356-5c6c-76d4-aa86-b1b48af2638e',
      issue_date: '01a17356-5c6c-76d4-aa86-b41d20d34ede',
      due_date: '01a17356-5c6c-76d4-aa86-b8db0db32253',
      tax_rate: '01a17356-5c6c-76d4-aa86-bd4b9d44ddb1',
      subtotal: '01a17356-5c6c-76d4-aa86-c1d93cf2f2e7',
      tax: '01a17356-5c6c-76d4-aa86-c59066b59374',
      total: '01a17356-5c6c-76d4-aa86-c80b50d2c4d8',
      notes: '01a17356-5c6c-76d4-aa86-cc1a9046986d',
      currency: '01a17356-5c6c-76d4-aa86-d22afc6d856d',
      discount_type: '01a17356-5c6c-76d4-aa86-d535e3951299',
      discount_value: '01a17356-5c6c-76d4-aa86-d8b798067adc',
      discount_amount: '01a17356-5c6c-76d4-aa86-dfbb2a48a56e',
      payment_methods: '01a17356-5c6c-76d4-aa86-e2f7b6c058f5',
      issuer_name: '01a17356-5c6c-76d4-aa86-e7aec2ae1a39',
      issuer_address: '01a17356-5c6c-76d4-aa86-ea34da9ba72c',
      issuer_tax_id: '01a17356-5c6c-76d4-aa86-eff9aa9d9c25',
      payment_url: '01a17356-5c6c-76d4-aa86-f2ae4cd95396',
    },
    invoice_line: {
      description: '01a17356-5c6c-76d4-aa86-f49125fa29b4',
      invoice: '01a17356-5c6c-76d4-aa86-fa78614813bc',
      quantity: '01a17356-5c6c-76d4-aa86-fdc3e5eed686',
      unit_price: '01a17356-5c6c-76d4-aa87-0178e83ed86c',
      tax_rate: '01a17356-5c6c-76d4-aa87-071b2363b727',
    },
    payment: {
      invoice: '01a17356-5c6c-76d4-aa87-0bc40070e83b',
      amount: '01a17356-5c6c-76d4-aa87-0cd64cecba19',
      paid_on: '01a17356-5c6c-76d4-aa87-10661300be8d',
      method: '01a17356-5c6c-76d4-aa87-1471400f3f68',
      reference: '01a17356-5c6c-76d4-aa87-198c82565045',
    },
  },
  views: {
    invoice: {
      all: '01a17356-5c6c-76d4-aa87-1f65a6633f69',
      outstanding: '01a17356-5c6c-76d4-aa87-23cfd35db538',
      board: '01a17356-5c6c-76d4-aa87-262a78fe720a',
    },
    invoice_line: {
      all: '01a17356-5c6c-76d4-aa87-285b5e72d9fb',
    },
    payment: {
      all: '01a17356-5c6c-76d4-aa87-2d1f9481d980',
    },
  },
  layouts: {
    invoice: {
      default: '01a17356-5c6c-76d4-aa87-30b9d69bec79',
    },
  },
  nav: {
    billing_group: '01a17356-5c6c-76d4-aa87-364c243b8271',
    overview: '01a17356-5c6c-76d4-aa87-39dbf8604ca9',
    invoices: '01a17356-5c6c-76d4-aa87-3dbfbdc737d2',
    payments: '01a17356-5c6c-76d4-aa87-423afe8844e8',
  },
  commands: {
    new_invoice: '01a17356-5c6c-76d4-aa87-450f64284f63',
    go_to_billing: '01a17356-5c6c-76d4-aa87-49b384bb8655',
  },
  blocks: {
    receivables: '01a17356-5c6d-765a-82b1-35f5c0ccdb29',
    collected: '01a17356-5c6d-765a-82b1-3af809181930',
    confirm_payment: '01a17356-5c6d-765a-82b1-3c7d63ff30a5',
    invoice_header: '01a17356-5c6d-765a-82b1-43f66510518c',
    invoice_figures: '01a17356-5c6d-765a-82b1-46b6d53d8606',
    invoice_lines: '01a17356-5c6d-765a-82b1-4a1875c62d83',
    invoice_payments: '01a17356-5c6d-765a-82b1-4d91015f78ac',
    invoice_details: '01a17356-5c6d-765a-82b1-52d512323df9',
  },
  actions: {
    recalculate_invoice: '01a17356-5c6d-765a-82b1-5723c123a586',
    add_payment: '01a17356-5c6d-765a-82b1-5be4ceb7855f',
  },
  policies: {
    review_payments: '01a17356-5c6d-765a-82b1-5ff40b1e82e6',
    large_invoices: '01a17356-5c6d-765a-82b1-606f8cc2a83d',
  },
  pages: {
    billing: '01a17356-5c6d-765a-82b1-64572df8ef82',
    billing_new: '01a17356-5c6d-765a-82b1-6b8808d560ca',
  },
} as const;

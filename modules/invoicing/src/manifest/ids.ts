/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  objects: {
    invoice: 'invoicing.invoice',
    invoice_line: 'invoicing.invoice_line',
    payment: 'invoicing.payment',
  },
  fields: {
    invoice: {
      number: 'invoicing.invoice.number',
      status: 'invoicing.invoice.status',
      company: 'invoicing.invoice.company',
      contact: 'invoicing.invoice.contact',
      deal: 'invoicing.invoice.deal',
      issue_date: 'invoicing.invoice.issue_date',
      due_date: 'invoicing.invoice.due_date',
      tax_rate: 'invoicing.invoice.tax_rate',
      subtotal: 'invoicing.invoice.subtotal',
      tax: 'invoicing.invoice.tax',
      total: 'invoicing.invoice.total',
      notes: 'invoicing.invoice.notes',
      currency: 'invoicing.invoice.currency',
      discount_type: 'invoicing.invoice.discount_type',
      discount_value: 'invoicing.invoice.discount_value',
      discount_amount: 'invoicing.invoice.discount_amount',
      payment_methods: 'invoicing.invoice.payment_methods',
      issuer_name: 'invoicing.invoice.issuer_name',
      issuer_address: 'invoicing.invoice.issuer_address',
      issuer_tax_id: 'invoicing.invoice.issuer_tax_id',
      payment_url: 'invoicing.invoice.payment_url',
    },
    invoice_line: {
      description: 'invoicing.invoice_line.description',
      invoice: 'invoicing.invoice_line.invoice',
      quantity: 'invoicing.invoice_line.quantity',
      unit_price: 'invoicing.invoice_line.unit_price',
      tax_rate: 'invoicing.invoice_line.tax_rate',
    },
    payment: {
      invoice: 'invoicing.payment.invoice',
      amount: 'invoicing.payment.amount',
      paid_on: 'invoicing.payment.paid_on',
      method: 'invoicing.payment.method',
      reference: 'invoicing.payment.reference',
    },
  },
  views: {
    invoice: {
      all: 'invoicing.invoice.all',
      outstanding: 'invoicing.invoice.outstanding',
      board: 'invoicing.invoice.board',
    },
    invoice_line: {
      all: 'invoicing.invoice_line.all',
    },
    payment: {
      all: 'invoicing.payment.all',
    },
  },
  layouts: {
    invoice: {
      default: 'invoicing.invoice.default',
    },
  },
  nav: {
    billing_group: 'invoicing.billing_group',
    overview: 'invoicing.overview',
    invoices: 'invoicing.invoices',
    payments: 'invoicing.payments',
  },
  commands: {
    new_invoice: 'invoicing.new_invoice',
    go_to_billing: 'invoicing.go_to_billing',
  },
  blocks: {
    receivables: 'invoicing.receivables',
    collected: 'invoicing.collected',
    confirm_payment: 'invoicing.confirm_payment',
    invoice_header: 'invoicing.invoice_header',
    invoice_figures: 'invoicing.invoice_figures',
    invoice_lines: 'invoicing.invoice_lines',
    invoice_payments: 'invoicing.invoice_payments',
    invoice_details: 'invoicing.invoice_details',
  },
  actions: {
    recalculate_invoice: 'invoicing.recalculate_invoice',
    add_payment: 'invoicing.add_payment',
  },
  policies: {
    payments: 'invoicing.payments',
    large_invoices: 'invoicing.large_invoices',
  },
  pages: {
    billing: 'invoicing.billing',
    billing_new: 'invoicing.billing_new',
  },
} as const;

/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  objects: {
    quote: 'quotes.quote',
    quote_item: 'quotes.quote_item',
  },
  fields: {
    quote: {
      title: 'quotes.quote.title',
      number: 'quotes.quote.number',
      status: 'quotes.quote.status',
      deal: 'quotes.quote.deal',
      company: 'quotes.quote.company',
      valid_until: 'quotes.quote.valid_until',
      total: 'quotes.quote.total',
      notes: 'quotes.quote.notes',
    },
    quote_item: {
      description: 'quotes.quote_item.description',
      quote: 'quotes.quote_item.quote',
      quantity: 'quotes.quote_item.quantity',
      unit_price: 'quotes.quote_item.unit_price',
    },
  },
  views: {
    quote: {
      all: 'quotes.quote.all',
      awaiting_answer: 'quotes.quote.awaiting_answer',
    },
    quote_item: {
      all: 'quotes.quote_item.all',
    },
  },
  layouts: {
    quote: {
      default: 'quotes.quote.default',
    },
  },
  nav: {
    quotes: 'quotes.quotes',
  },
  commands: {
    new_quote: 'quotes.new_quote',
  },
  blocks: {
    quote_items: 'quotes.quote_items',
    deal_quotes: 'quotes.deal_quotes',
  },
  actions: {
    recalculate_quote: 'quotes.recalculate_quote',
  },
} as const;

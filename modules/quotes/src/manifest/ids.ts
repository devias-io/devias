/** Every id the module owns, its own included, written once; the manifest and the module's code point at them. */
export const ids = {
  module: '01a173cd-7d37-7041-9060-4234df6192ae',
  objects: {
    quote: '01a17356-5c6d-765a-82b2-067efe9f82a4',
    quote_item: '01a17356-5c6d-765a-82b2-090990f2ee1c',
  },
  fields: {
    quote: {
      title: '01a17356-5c6d-765a-82b2-0d6dec623df1',
      number: '01a17356-5c6d-765a-82b2-12f0382cc4f1',
      status: '01a17356-5c6d-765a-82b2-178b431c1cbb',
      deal: '01a17356-5c6d-765a-82b2-18ee42b9d88e',
      company: '01a17356-5c6d-765a-82b2-1f68a249656f',
      valid_until: '01a17356-5c6d-765a-82b2-2040d8993903',
      total: '01a17356-5c6d-765a-82b2-256670a22c46',
      notes: '01a17356-5c6d-765a-82b2-29d1748c8748',
    },
    quote_item: {
      description: '01a17356-5c6d-765a-82b2-2c3e344f80d0',
      quote: '01a17356-5c6d-765a-82b2-329f1ad7f64b',
      quantity: '01a17356-5c6d-765a-82b2-357605cadb34',
      unit_price: '01a17356-5c6d-765a-82b2-3ad226c6a8ff',
    },
  },
  views: {
    quote: {
      all: '01a17356-5c6d-765a-82b2-3e09c1420a6c',
      awaiting_answer: '01a17356-5c6d-765a-82b2-405c56da9796',
    },
    quote_item: {
      all: '01a17356-5c6d-765a-82b2-441413149dee',
    },
  },
  layouts: {
    quote: {
      default: '01a17356-5c6d-765a-82b2-4831306b6dc7',
    },
  },
  nav: {
    quotes: '01a17356-5c6d-765a-82b2-4c27fa2dc89b',
  },
  commands: {
    new_quote: '01a17356-5c6d-765a-82b2-53c107100dcb',
  },
  blocks: {
    quote_items: '01a17356-5c6d-765a-82b2-554bb0ddabcd',
    deal_quotes: '01a17356-5c6d-765a-82b2-5b8f8f2768a7',
  },
  actions: {
    recalculate_quote: '01a17356-5c6d-765a-82b2-5c9e186de6db',
  },
} as const;

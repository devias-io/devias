/** Every id the module owns, its own included, written once; the manifest and the module's code point at them. */
export const ids = {
  module: '01a173cd-7d37-7041-9060-4c5e734c8e86',
  objects: {
    location: '01a17356-5c6c-76d4-aa86-184166532ca0',
    stock_move: '01a17356-5c6c-76d4-aa86-1d0e8d9f8e06',
  },
  fields: {
    location: {
      name: '01a17356-5c6c-76d4-aa86-22c0ae4d5cee',
      kind: '01a17356-5c6c-76d4-aa86-2408b5f3a7d6',
      address: '01a17356-5c6c-76d4-aa86-2abdb0daa9e6',
      notes: '01a17356-5c6c-76d4-aa86-2fd728edb85a',
    },
    stock_move: {
      reference: '01a17356-5c6c-76d4-aa86-314cdd21fce6',
      product: '01a17356-5c6c-76d4-aa86-36d8c315bdda',
      location: '01a17356-5c6c-76d4-aa86-3b072d25f2e9',
      direction: '01a17356-5c6c-76d4-aa86-3e3684c5fb52',
      quantity: '01a17356-5c6c-76d4-aa86-43c8f1370fcf',
      reason: '01a17356-5c6c-76d4-aa86-44d94b9655e7',
      moved_on: '01a17356-5c6c-76d4-aa86-4a02d643df47',
      deal: '01a17356-5c6c-76d4-aa86-4f0a8a302d55',
      supplier: '01a17356-5c6c-76d4-aa86-50f6b2469f68',
      unit_cost: '01a17356-5c6c-76d4-aa86-5571f7eb3086',
    },
    product: {
      tracked: '01a17356-5c6c-76d4-aa86-596eac9be506',
      reorder_point: '01a17356-5c6c-76d4-aa86-5c3e39e7b7aa',
    },
  },
  views: {
    stock_move: {
      all: '01a17356-5c6c-76d4-aa86-62b1dbefbcbd',
    },
    location: {
      all: '01a17356-5c6c-76d4-aa86-662252eedd05',
    },
  },
  nav: {
    inventory: '01a17356-5c6c-76d4-aa86-6ab17bfa0913',
    locations: '01a17356-5c6c-76d4-aa86-6fdfb56492c5',
    stock_moves: '01a17356-5c6c-76d4-aa86-73d48c218736',
  },
  commands: {
    new_stock_move: '01a17356-5c6c-76d4-aa86-7625140fdfc8',
    go_to_inventory: '01a17356-5c6c-76d4-aa86-79b33e5c1ddc',
  },
  blocks: {
    product_stock: '01a17356-5c6c-76d4-aa86-7fbc7895d31f',
    low_stock: '01a17356-5c6c-76d4-aa86-822c4451d360',
  },
  actions: {
    stock_on_hand: '01a17356-5c6c-76d4-aa86-86955aaa87c9',
    transfer: '01a17356-5c6c-76d4-aa86-8adb80d5eec8',
    count: '01a17356-5c6c-76d4-aa86-8c88336ac9a8',
  },
  policies: {
    counts: '01a17356-5c6c-76d4-aa86-906d79c9f1ed',
  },
} as const;

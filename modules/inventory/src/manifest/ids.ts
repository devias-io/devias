/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  objects: {
    location: 'inventory.location',
    stock_move: 'inventory.stock_move',
  },
  fields: {
    location: {
      name: 'inventory.location.name',
      kind: 'inventory.location.kind',
      address: 'inventory.location.address',
      notes: 'inventory.location.notes',
    },
    stock_move: {
      reference: 'inventory.stock_move.reference',
      product: 'inventory.stock_move.product',
      location: 'inventory.stock_move.location',
      direction: 'inventory.stock_move.direction',
      quantity: 'inventory.stock_move.quantity',
      reason: 'inventory.stock_move.reason',
      moved_on: 'inventory.stock_move.moved_on',
      deal: 'inventory.stock_move.deal',
      supplier: 'inventory.stock_move.supplier',
      unit_cost: 'inventory.stock_move.unit_cost',
    },
    product: {
      tracked: 'inventory.product.tracked',
      reorder_point: 'inventory.product.reorder_point',
    },
  },
  views: {
    stock_move: {
      all: 'inventory.stock_move.all',
    },
    location: {
      all: 'inventory.location.all',
    },
  },
  nav: {
    inventory: 'inventory.inventory',
    locations: 'inventory.locations',
    stock_moves: 'inventory.stock_moves',
  },
  commands: {
    new_stock_move: 'inventory.new_stock_move',
    go_to_inventory: 'inventory.go_to_inventory',
  },
  blocks: {
    product_stock: 'inventory.product_stock',
    low_stock: 'inventory.low_stock',
  },
  actions: {
    stock_on_hand: 'inventory.stock_on_hand',
    transfer: 'inventory.transfer',
    count: 'inventory.count',
  },
  policies: {
    counts: 'inventory.counts',
  },
} as const;

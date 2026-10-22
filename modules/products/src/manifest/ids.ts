/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  objects: {
    product: 'products.product',
    price: 'products.price',
  },
  fields: {
    product: {
      name: 'products.product.name',
      description: 'products.product.description',
      kind: 'products.product.kind',
      sku: 'products.product.sku',
      images: 'products.product.images',
      unit: 'products.product.unit',
      active: 'products.product.active',
      default_price: 'products.product.default_price',
    },
    price: {
      nickname: 'products.price.nickname',
      product: 'products.price.product',
      amount: 'products.price.amount',
      currency: 'products.price.currency',
      type: 'products.price.type',
      interval: 'products.price.interval',
      interval_count: 'products.price.interval_count',
      tax_behavior: 'products.price.tax_behavior',
      lookup_key: 'products.price.lookup_key',
      active: 'products.price.active',
    },
  },
  views: {
    product: {
      all: 'products.product.all',
      goods: 'products.product.goods',
      services: 'products.product.services',
    },
    price: {
      all: 'products.price.all',
    },
  },
  layouts: {
    product: {
      default: 'products.product.default',
    },
  },
  nav: {
    products: 'products.products',
  },
  commands: {
    new_product: 'products.new_product',
  },
  blocks: {
    product_description: 'products.product_description',
    product_images: 'products.product_images',
    product_prices: 'products.product_prices',
  },
} as const;

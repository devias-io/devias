/** Every id the module owns, its own included, written once; the manifest and the module's code point at them. */
export const ids = {
  module: '01a173cd-7d37-7041-9060-3ce055bfd268',
  objects: {
    product: '01a17356-5c6d-765a-82b1-8c25f7a727c2',
    price: '01a17356-5c6d-765a-82b1-9365f2abe679',
  },
  fields: {
    product: {
      name: '01a17356-5c6d-765a-82b1-95e006171d3a',
      description: '01a17356-5c6d-765a-82b1-9a0e51db328f',
      kind: '01a17356-5c6d-765a-82b1-9e0e63227d97',
      sku: '01a17356-5c6d-765a-82b1-a3450d888269',
      images: '01a17356-5c6d-765a-82b1-a473c1ef8875',
      unit: '01a17356-5c6d-765a-82b1-a942feabdd47',
      active: '01a17356-5c6d-765a-82b1-afc945bb50c9',
      default_price: '01a17356-5c6d-765a-82b1-b019e7050eac',
    },
    price: {
      nickname: '01a17356-5c6d-765a-82b1-b47404f0ebc9',
      product: '01a17356-5c6d-765a-82b1-b91ea183c4fd',
      amount: '01a17356-5c6d-765a-82b1-bdc0ccc432ef',
      currency: '01a17356-5c6d-765a-82b1-c063adb14ba3',
      type: '01a17356-5c6d-765a-82b1-c428bbbf96e2',
      interval: '01a17356-5c6d-765a-82b1-c8aca5cd79c8',
      interval_count: '01a17356-5c6d-765a-82b1-cdbd56266012',
      tax_behavior: '01a17356-5c6d-765a-82b1-d347c39d1d9d',
      lookup_key: '01a17356-5c6d-765a-82b1-d5065ea56622',
      active: '01a17356-5c6d-765a-82b1-d9b3c5b5d220',
    },
  },
  views: {
    product: {
      all: '01a17356-5c6d-765a-82b1-ddcf6e122f0e',
      goods: '01a17356-5c6d-765a-82b1-e37069c5da2d',
      services: '01a17356-5c6d-765a-82b1-e435b1cc1269',
    },
    price: {
      all: '01a17356-5c6d-765a-82b1-e80f41664405',
    },
  },
  layouts: {
    product: {
      default: '01a17356-5c6d-765a-82b1-ed45210619b1',
    },
  },
  nav: {
    products: '01a17356-5c6d-765a-82b1-f2358ce1e467',
  },
  commands: {
    new_product: '01a17356-5c6d-765a-82b1-f412c4cccb13',
  },
  blocks: {
    product_description: '01a17356-5c6d-765a-82b1-f8598e42f1bd',
    product_images: '01a17356-5c6d-765a-82b1-fcc4e0e2567c',
    product_prices: '01a17356-5c6d-765a-82b2-02e88298df69',
  },
} as const;

/** Every id the module owns, its own included, written once; the manifest and the module's code point at them. */
export const ids = {
  module: '01a173cd-7d37-7041-9060-48e2f17111b0',
  objects: {
    expense: '01a17356-5c6c-76d4-aa85-bba48cd40af2',
  },
  fields: {
    expense: {
      description: '01a17356-5c6c-76d4-aa85-beb18907b62f',
      amount: '01a17356-5c6c-76d4-aa85-c0c6564a4c76',
      currency: '01a17356-5c6c-76d4-aa85-c40d2725706a',
      tax: '01a17356-5c6c-76d4-aa85-cbeccfff728e',
      spent_on: '01a17356-5c6c-76d4-aa85-cd729f0d11cb',
      category: '01a17356-5c6c-76d4-aa85-d1785f9321f9',
      status: '01a17356-5c6c-76d4-aa85-d493c366cc2f',
      paid_with: '01a17356-5c6c-76d4-aa85-da442a60b6da',
      supplier: '01a17356-5c6c-76d4-aa85-dca11405b609',
      deal: '01a17356-5c6c-76d4-aa85-e2bdc77519ba',
      receipt_url: '01a17356-5c6c-76d4-aa85-e64befa627b1',
      notes: '01a17356-5c6c-76d4-aa85-ea83802f291a',
    },
  },
  views: {
    expense: {
      all: '01a17356-5c6c-76d4-aa85-ecb0d7b9fb96',
      by_status: '01a17356-5c6c-76d4-aa85-f1b6552a9d6a',
      to_approve: '01a17356-5c6c-76d4-aa85-f47a96324d0f',
      to_reimburse: '01a17356-5c6c-76d4-aa85-fbb520eea693',
    },
  },
  nav: {
    expenses: '01a17356-5c6c-76d4-aa85-fd261dee494f',
    all_expenses: '01a17356-5c6c-76d4-aa86-02abb6289979',
    to_approve: '01a17356-5c6c-76d4-aa86-05e1a97359d3',
    to_reimburse: '01a17356-5c6c-76d4-aa86-08caa9f4279a',
  },
  commands: {
    new_expense: '01a17356-5c6c-76d4-aa86-0eaabde42889',
    go_to_expenses: '01a17356-5c6c-76d4-aa86-1170cc9e4f0b',
  },
  policies: {
    large_expenses: '01a17356-5c6c-76d4-aa86-17e86cb35d8b',
  },
} as const;

/** Every id the module owns, written once; the manifest and the module's code point at them. */
export const ids = {
  objects: {
    expense: 'expenses.expense',
  },
  fields: {
    expense: {
      description: 'expenses.expense.description',
      amount: 'expenses.expense.amount',
      currency: 'expenses.expense.currency',
      tax: 'expenses.expense.tax',
      spent_on: 'expenses.expense.spent_on',
      category: 'expenses.expense.category',
      status: 'expenses.expense.status',
      paid_with: 'expenses.expense.paid_with',
      supplier: 'expenses.expense.supplier',
      deal: 'expenses.expense.deal',
      receipt_url: 'expenses.expense.receipt_url',
      notes: 'expenses.expense.notes',
    },
  },
  views: {
    expense: {
      all: 'expenses.expense.all',
      by_status: 'expenses.expense.by_status',
      to_approve: 'expenses.expense.to_approve',
      to_reimburse: 'expenses.expense.to_reimburse',
    },
  },
  nav: {
    expenses: 'expenses.expenses',
    all_expenses: 'expenses.all_expenses',
    to_approve: 'expenses.to_approve',
    to_reimburse: 'expenses.to_reimburse',
  },
  commands: {
    new_expense: 'expenses.new_expense',
    go_to_expenses: 'expenses.go_to_expenses',
  },
  policies: {
    large_expenses: 'expenses.large_expenses',
  },
} as const;

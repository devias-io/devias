import { defineModule } from '@devias/core';
import { ids } from './ids';
import { commandItems, navItems } from './navigation';
import { objects } from './objects';
import { policies } from './policies';
import { views } from './views';

/**
 * Pure manifest, data only: what the business spends, by category, supplier (a CRM company) and deal (the job it was
 * for), from draft through approval to reimbursement when someone paid it themselves. The CRM must be installed
 * first. The agent logs, finds and adds expenses up with its record tools.
 */
export const manifest = defineModule({
  id: ids.module,
  version: '0.1.0',
  label: 'Expenses',
  description: 'What the business spends, by category, supplier and deal, from approval to reimbursement.',
  icon: 'wallet',
  objects,
  views,
  navItems,
  commandItems,
  policies,
});

export { ids } from './ids';

export { CURRENCY, EXPENSE_CATEGORIES, EXPENSE_STATUSES, type Expense, type ExpenseStatus, PAID_WITH } from './objects';

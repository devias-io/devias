import type { DeviasConfig } from '@devias/core';

/**
 * The modules this install ships with. The studio and the server both read this list, so adding a module is:
 *
 *   1. `pnpm add -w <package>` (a module in this repo goes under `modules/` and is added as `workspace:*`)
 *   2. list it here
 *
 * Each workspace then installs the modules it wants from Settings → Modules (core modules come with every
 * workspace). Order matters on the studio side: a later module overrides an earlier one's contributions.
 * Options go to the module's studio side: `{ package: '@acme/mod-recruiting', options: { currency: 'EUR' } }`.
 *
 * Only `import type` here: Vite reads this file before anything is compiled.
 */
export default {
  modules: [
    '@devias/mod-crm',
    '@devias/mod-products',
    '@devias/mod-quotes',
    '@devias/mod-invoicing',
    '@devias/mod-expenses',
    '@devias/mod-inventory',
    '@devias/mod-payment-stripe',
    '@devias/mod-email-resend',
  ],
} satisfies DeviasConfig;

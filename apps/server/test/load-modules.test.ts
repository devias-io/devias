import { ids as crmIds } from '@devias/mod-crm/manifest';
import { ids as emailIds } from '@devias/mod-email-resend/manifest';
import { ids as enrichmentIds } from '@devias/mod-enrichment-context-dev/manifest';
import { ids as expenseIds } from '@devias/mod-expenses/manifest';
import { ids as inventoryIds } from '@devias/mod-inventory/manifest';
import { ids as invoicingIds } from '@devias/mod-invoicing/manifest';
import { ids as stripeIds } from '@devias/mod-payment-stripe/manifest';
import { ids as productIds } from '@devias/mod-products/manifest';
import { ids as quotesIds } from '@devias/mod-quotes/manifest';
import { loadModules } from '@devias/server';
import { manifest as studioManifest } from '@devias/studio/manifest';
import { describe, expect, it } from 'vitest';
import deviasConfig from '../../../devias.config';

describe('loadModules', () => {
  it('loads every module in devias.config.ts, the studio first', async () => {
    const modules = await loadModules(deviasConfig, { from: import.meta.url });
    expect(modules.map((module) => module.manifest.id)).toEqual([
      studioManifest.id,
      crmIds.module,
      productIds.module,
      quotesIds.module,
      invoicingIds.module,
      expenseIds.module,
      inventoryIds.module,
      stripeIds.module,
      emailIds.module,
      enrichmentIds.module,
    ]);
    // A module with server code brings its actions; one with only a manifest is still registered.
    expect(modules.find((module) => module.manifest.id === quotesIds.module)?.actions.map((a) => a.id)).toEqual([
      quotesIds.actions.recalculate_quote,
    ]);
  });

  it('names the package it cannot find and how to add it', async () => {
    await expect(loadModules({ modules: ['@devias/mod-nope'] }, { from: import.meta.url })).rejects.toThrow(
      'devias.config.ts lists "@devias/mod-nope", which cannot be found',
    );
  });
});

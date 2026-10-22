import { loadModules } from '@devias/server';
import { describe, expect, it } from 'vitest';
import deviasConfig from '../../../devias.config';

describe('loadModules', () => {
  it('loads every module in devias.config.ts, the studio first', async () => {
    const modules = await loadModules(deviasConfig, { from: import.meta.url });
    expect(modules.map((module) => module.manifest.id)).toEqual([
      'studio',
      'crm',
      'products',
      'quotes',
      'invoicing',
      'expenses',
      'inventory',
      'payment-stripe',
      'email-resend',
    ]);
    // A module with server code brings its actions; one with only a manifest is still registered.
    expect(modules.find((module) => module.manifest.id === 'quotes')?.actions.map((a) => a.id)).toEqual([
      'quotes.recalculate_quote',
    ]);
  });

  it('names the package it cannot find and how to add it', async () => {
    await expect(loadModules({ modules: ['@devias/mod-nope'] }, { from: import.meta.url })).rejects.toThrow(
      'devias.config.ts lists "@devias/mod-nope", which cannot be found',
    );
  });
});

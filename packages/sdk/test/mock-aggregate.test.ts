import { manifest as fixture } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { demoClient } from './demo-data';

const client = () => demoClient({ workspaceId: 'ws_test', manifests: [fixture] });

describe('mock aggregation', () => {
  it('groups like the server: every stage in order, relation groups labelled, totals', async () => {
    const mock = client();
    const deals = (await mock.records.list({ object: 'opportunity', limit: 200 })).items;
    const byStage = await mock.records.aggregate({
      object: 'opportunity',
      groupBy: 'stage',
      measures: [{ fn: 'count' }, { fn: 'sum', field: 'amount' }],
    });
    expect(byStage.groups[0]).toMatchObject({ key: 'new', label: expect.any(String) });
    expect(byStage.total.count).toBe(deals.length);
    const amount = deals.reduce((sum, deal) => sum + (typeof deal.amount === 'number' ? deal.amount : 0), 0);
    expect(byStage.total.values['sum.amount']).toBeCloseTo(amount);
    expect(byStage.groups.reduce((sum, group) => sum + group.count, 0)).toBe(deals.length);

    const byCompany = await mock.records.aggregate({ object: 'opportunity', groupBy: 'company' });
    const named = byCompany.groups.find((group) => group.key !== null);
    expect(named?.label).toEqual(expect.any(String));
  });

  it('refuses what the fields cannot support', async () => {
    await expect(client().records.aggregate({ object: 'opportunity', groupBy: 'amount' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});

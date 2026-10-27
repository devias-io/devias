import { localDate } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { createMockClient } from '@devias/sdk/mock';
import { installLayoutStubs, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { collectedBlock } from '../src/studio/blocks/collected';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const now = new Date();
const daysAgo = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
const monday = daysAgo((now.getDay() + 6) % 7);

describe('Money in', () => {
  it('adds the payments up over the period it shows, with today and this week beside', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [crm, manifest] });
    const schema = await client.metadata.getSchema();
    const invoice = await client.records.create('invoice', { number: 'INV-1', status: 'sent' });
    const paid = [
      { days: 0, amount: 100 },
      { days: 2, amount: 50 },
      { days: 40, amount: 1000 },
    ];

    for (const { days, amount } of paid) {
      await client.records.create('payment', { invoice: invoice.id, amount, paid_on: localDate(daysAgo(days)) });
    }

    const thisWeek = paid.filter(({ days }) => daysAgo(days) >= monday).reduce((sum, { amount }) => sum + amount, 0);
    const Block = collectedBlock.component;
    render(
      <TestProviders client={client} schema={schema}>
        <Block config={{}} surface="home" />
      </TestProviders>,
    );
    // The last 7 days leave out the payment of 40 days ago. From Wednesday on this week holds the same payments, so
    // the figure can show twice: once as the total and once beside "This week".
    expect((await screen.findAllByText('€150.00')).length).toBeGreaterThan(0);
    expect(screen.getByText('Today').nextSibling?.textContent).toBe('€100.00');
    expect(screen.getByText('This week').nextSibling?.textContent).toBe(
      new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(thisWeek),
    );
    fireEvent.click(screen.getByRole('tab', { name: '3M' }));
    expect(await screen.findByText('€1,150.00')).toBeTruthy();
    expect(screen.getByText('Last 3 months')).toBeTruthy();
  });
});

import { manifest as crm } from '@devias/mod-crm/manifest';
import { createMockClient } from '@devias/sdk/mock';
import { RecordPage } from '@devias/studio';
import { resolvedFixture, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { dealQuotesBlock } from '../src/studio/blocks/deal-quotes';

afterEach(cleanup);

/** A deal's page with the Quotes module installed beside the CRM. */
const setup = async () => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [crm, manifest] });
  const schema = await client.metadata.getSchema();
  const object = schema.objects.find((candidate) => candidate.nameSingular === 'deal');

  if (!object) {
    throw new Error('the CRM is installed');
  }

  const company = await client.records.create('company', { name: 'Harbor Finance' });
  const deal = await client.records.create('deal', { name: 'Buy company', company: company.id });
  const show = () =>
    render(
      <TestProviders client={client} schema={schema} config={resolvedFixture({ blocks: [dealQuotesBlock] })}>
        <RecordPage object={object} recordId={deal.id} />
      </TestProviders>,
    );

  return { client, deal, company, show };
};

describe('the deal quotes block', () => {
  it('places itself in the deal page, right after the stage, without the CRM naming it', async () => {
    const { show } = await setup();
    show();
    const cell = await waitFor(() => {
      const found = document.querySelector('[data-block="quotes.deal_quotes"]');

      if (!found) {
        throw new Error('waiting');
      }

      return found as HTMLElement;
    });
    const main = document.querySelector('[data-slot="split-main"]');
    const order = [...(main?.querySelectorAll('[data-cell]') ?? [])].map((node) => node.getAttribute('data-block'));
    // The CRM's cells in their order, with Quotes slipped in after the stage.
    expect(order.slice(0, 4)).toEqual(['core.title', 'crm.deal_stage', 'quotes.deal_quotes', 'core.comments']);
    expect(await within(cell).findByText(/No quote yet/)).toBeTruthy();
    expect(within(cell).getByRole('heading', { name: 'Quotes' })).toBeTruthy();
  });

  it('lists the deal’s quotes, newest first, each with its status and total', async () => {
    const { show, client, deal, company } = await setup();
    await client.records.create('quote', {
      title: 'Proposal v1',
      deal: deal.id,
      company: company.id,
      status: 'sent',
      total: 20000,
    });
    show();
    const quotes = within(await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'deal-quotes'));
    expect((await quotes.findByRole('link', { name: 'Proposal v1' })).getAttribute('href')).toMatch(
      /\/records\/quote\//,
    );
    expect(quotes.getByText('Sent')).toBeTruthy();
    expect(quotes.getByText(/20,000\.00/)).toBeTruthy();
  });

  it('starts the next quote as a draft for the deal and its company', async () => {
    const { show, client, deal, company } = await setup();
    show();
    const quotes = within(await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'deal-quotes'));
    expect(await quotes.findByText('No quote yet.')).toBeTruthy();
    fireEvent.click(quotes.getByRole('button', { name: /New quote/ }));
    await waitFor(async () => {
      const made = await client.records.list({ object: 'quote' });
      expect(made.items).toHaveLength(1);
      expect(made.items[0]).toMatchObject({
        title: 'Buy company',
        status: 'draft',
        deal: deal.id,
        company: company.id,
      });
    });
  });
});

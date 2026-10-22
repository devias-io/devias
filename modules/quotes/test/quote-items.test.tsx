import { manifest as crm } from '@devias/mod-crm/manifest';
import { createMockClient } from '@devias/sdk/mock';
import { RecordPage } from '@devias/studio';
import { resolvedFixture, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifest } from '../src/manifest';
import { quoteItemsBlock } from '../src/studio/blocks/quote-items';

afterEach(cleanup);

/** A quote's page, as the studio draws it from the module's layout and blocks. */
const setup = async (data: Record<string, unknown> = {}) => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [crm, manifest] });
  const schema = await client.metadata.getSchema();
  const object = schema.objects.find((candidate) => candidate.nameSingular === 'quote');

  if (!object) {
    throw new Error('the Quotes module is installed');
  }

  const quote = await client.records.create('quote', { title: 'Annual plan', status: 'draft', ...data });
  const item = (description: string, quantity: number, unitPrice: number) =>
    client.records.create('quote_item', { quote: quote.id, description, quantity, unit_price: unitPrice });
  const show = () =>
    render(
      <TestProviders client={client} schema={schema} config={resolvedFixture({ blocks: [quoteItemsBlock] })}>
        <RecordPage object={object} recordId={quote.id} />
      </TestProviders>,
    );
  const saved = async () => client.records.get('quote', quote.id);

  return { client, quote, item, show, saved };
};

describe('the quote page', () => {
  it('is one flow: its title, its items, then the conversation, with its terms beside', async () => {
    const { show } = await setup();
    show();
    await screen.findByText('Items');
    expect(document.querySelector('[data-slot="split-shell"]')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    const main = document.querySelector('[data-slot="split-main"]');
    expect([...(main?.querySelectorAll('[data-cell]') ?? [])].map((cell) => cell.getAttribute('data-cell'))).toEqual([
      'title',
      'quote_items',
      'notes',
      'activity',
    ]);
    expect(screen.getByRole('complementary', { name: 'Quote' })).toBeTruthy();
  });
});

describe('the items block', () => {
  it('adds an item from the row at the end, and the total follows the items', async () => {
    const { show, saved, client, quote } = await setup();
    show();
    const description = await screen.findByLabelText('New item');
    fireEvent.change(description, { target: { value: 'Consulting' } });
    fireEvent.change(screen.getByLabelText('New item quantity'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('New item unit price'), { target: { value: '1000' } });
    fireEvent.keyDown(description, { key: 'Enter' });
    await waitFor(async () => expect(await saved()).toMatchObject({ total: 2000 }));
    const items = await client.records.list({
      object: 'quote_item',
      filter: { field: 'quote', op: 'eq', value: quote.id },
    });
    expect(items.items.map((row) => [row.description, row.quantity, row.unit_price])).toEqual([
      ['Consulting', 2, 1000],
    ]);
    // The row is ready for the next one.
    expect((screen.getByLabelText('New item') as HTMLInputElement).value).toBe('');
    await waitFor(() => expect(document.querySelector('[data-slot="quote-total"]')?.textContent).toContain('2,000.00'));

    // Removing an item brings the total back down.
    await client.records.create('quote_item', { quote: quote.id, description: 'Extra', quantity: 1, unit_price: 500 });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Remove item' }))[0] as HTMLElement);
    await waitFor(async () => expect(await saved()).toMatchObject({ total: 500 }));
  });

  it('writes nothing just by being opened, even when the total is stale', async () => {
    const { show, item, client } = await setup({ total: 1 });
    await item('Work', 1, 100);
    const update = vi.spyOn(client.records, 'update');
    show();
    await waitFor(() => expect(document.querySelector('[data-slot="quote-total"]')).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(update).not.toHaveBeenCalled();
  });

  it('is final once the quote is no longer a draft: no editing, and it says why', async () => {
    const { show, item } = await setup({ status: 'sent' });
    await item('Work', 1, 100);
    show();
    expect(await screen.findByText('Items can only be changed while the quote is a draft.')).toBeTruthy();
    expect(screen.queryByLabelText('New item')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove item' })).toBeNull();
    expect(await screen.findByText('Work')).toBeTruthy();
  });
});

import { createMockClient } from '@devias/sdk/mock';
import { RecordPage } from '@devias/studio';
import { resolvedFixture, TestProviders } from '@devias/studio/testing';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { dealStageBlock } from '../src/studio/blocks/deal-stage';

afterEach(cleanup);

/** A deal's page, as the studio draws it from the CRM's layout and blocks. */
const setup = async (data: Record<string, unknown> = {}) => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [manifest] });
  const schema = await client.metadata.getSchema();
  const object = schema.objects.find((candidate) => candidate.nameSingular === 'deal');

  if (!object) {
    throw new Error('the CRM is installed');
  }

  const company = await client.records.create('company', { name: 'Harbor Finance' });
  const deal = await client.records.create('deal', {
    name: 'Buy company',
    stage: 'proposal',
    company: company.id,
    next_step: 'Send the revised proposal',
    ...data,
  });
  const show = () =>
    render(
      <TestProviders client={client} schema={schema} config={resolvedFixture({ blocks: [dealStageBlock] })}>
        <RecordPage object={object} recordId={deal.id} />
      </TestProviders>,
    );
  const saved = async () => client.records.get('deal', deal.id);

  return { client, deal, company, show, saved };
};

describe('the deal page', () => {
  it('is one page, not tabs: the stage, then comments and activity, with its terms beside', async () => {
    const { show } = await setup();
    show();
    await screen.findByText('Comments');
    expect(document.querySelector('[data-slot="split-shell"]')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    const main = document.querySelector('[data-slot="split-main"]');
    expect([...(main?.querySelectorAll('[data-cell]') ?? [])].map((cell) => cell.getAttribute('data-cell'))).toEqual([
      'title',
      'deal_stage',
      'comments',
      'activity',
    ]);
    // Nothing of the Quotes module is named here (the four cells above are all): it adds its own section to the page
    // where it is installed.
    expect(screen.getByRole('complementary', { name: 'People' })).toBeTruthy();
  });
});

describe('the stage block', () => {
  it('shows where the deal is, and a line of what it is worth', async () => {
    const { show } = await setup({ probability: 60, amount: 24000 });
    show();
    const stepper = await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'stage-stepper');
    expect(within(stepper).getByRole('button', { name: 'Move to Proposal' }).getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('60% likely')).toBeTruthy();
    expect(screen.getByText('€24,000')).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'Harbor Finance' })).toBeTruthy();
    expect(screen.getByText('Send the revised proposal')).toBeTruthy();
  });

  it('moves the deal when a step is clicked, and Mark won goes to Customer', async () => {
    const { show, saved } = await setup();
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Move to Meeting' }));
    await waitFor(async () => expect(await saved()).toMatchObject({ stage: 'meeting' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark won' }));
    await waitFor(async () => expect(await saved()).toMatchObject({ stage: 'customer' }));
    // A won deal can be reopened, not marked again.
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark won' })).toBeNull();
  });

  it('asks why before marking a deal lost, and reopening clears the reason', async () => {
    const { show, saved } = await setup();
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Mark lost' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Mark lost' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Reason'), { target: { value: 'price' } });
    await waitFor(() => expect(confirm.disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(async () => expect(await saved()).toMatchObject({ stage: 'lost', lost_reason: 'price' }));
    expect(await screen.findByText('Lost')).toBeTruthy();
    expect(document.querySelector('[data-slot="stage-stepper"]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(async () => expect(await saved()).toMatchObject({ stage: 'new' }));
    expect((await saved()).lost_reason ?? null).toBeNull();
  });
});

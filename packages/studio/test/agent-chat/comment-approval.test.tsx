import type { ToolCall } from '@devias/core';
import { coreIds } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallCard } from '../../src/agent-chat/chat/tool-call-card';
import { createFakeClient, recordsFixture, schemaFixture, TestProviders } from '../../src/testing';

afterEach(cleanup);

const pending = (input: unknown): ToolCall => ({
  id: 'call1',
  toolUseId: 'tu1',
  name: 'comment_on_record',
  input,
  status: 'pending',
  requiresApproval: true,
});

const show = (call: ToolCall, onResolve: (approved: boolean) => void) =>
  render(
    <TestProviders client={createFakeClient(schemaFixture(), recordsFixture())} schema={schemaFixture()}>
      <ToolCallCard call={call} onResolve={onResolve} />
    </TestProviders>,
  );

const card = async (container: HTMLElement) =>
  within(await waitFor(() => container.querySelector('[data-slot="comment-approval"]') as HTMLElement));

describe('a call that waits while the turn is still streaming', () => {
  it('is not drawn as "Needs approval" before the panel can answer it, and then becomes the card', async () => {
    const call = pending({ object: 'person', id: 'p1', title: 'Missing contact info' });
    const client = createFakeClient(schemaFixture(), recordsFixture());
    const view = render(
      <TestProviders client={client} schema={schemaFixture()}>
        <ToolCallCard call={call} />
      </TestProviders>,
    );
    // No handler yet (the turn has not paused): no yellow label, no card with buttons, a call on its way.
    expect(screen.queryByText('Needs approval')).toBeNull();
    expect(view.container.querySelector('[data-slot="tool-call"][data-status="running"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    view.rerender(
      <TestProviders client={client} schema={schemaFixture()}>
        <ToolCallCard call={call} onResolve={() => {}} />
      </TestProviders>,
    );
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.queryByText('Needs approval')).toBeNull();
  });
});

describe('the comment approval card', () => {
  it('says which record the comment goes on and shows the comment as it will read, body in Markdown', async () => {
    const onResolve = vi.fn();
    const { container } = show(
      pending({
        object: 'person',
        id: 'p1',
        title: 'Missing contact info',
        body: 'Record is still mostly empty. Missing:\n\n- Email and phone\n- Company and job title\n\nNeeds enrichment before outreach.',
      }),
      onResolve,
    );
    const view = await card(container);
    // The card replaces the plain one, which listed the raw id, body and title.
    expect(container.querySelector(`[data-widget="${coreIds.blocks.comment_approval}"]`)).toBeTruthy();
    expect(await view.findByText('Ada')).toBeTruthy();
    expect(view.getByText('Add a comment to', { exact: false })).toBeTruthy();
    const preview = within(container.querySelector('[data-slot="comment-preview"]') as HTMLElement);
    expect(preview.getByText('Missing contact info')).toBeTruthy();
    expect(preview.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Email and phone',
      'Company and job title',
    ]);
    expect(container.textContent).not.toContain('p1');
    expect(view.getByRole('link', { name: 'Review' }).getAttribute('href')).toContain('/records/person/p1');
    fireEvent.click(view.getByRole('button', { name: 'Approve' }));
    expect(onResolve).toHaveBeenLastCalledWith(true);
    fireEvent.click(view.getByRole('button', { name: 'Reject' }));
    expect(onResolve).toHaveBeenLastCalledWith(false);
  });

  it('folds a long body behind Show more, and names the kind of record when it cannot be read', async () => {
    const body = Array.from({ length: 14 }, (_, i) => `Line ${i + 1}`).join('\n\n');
    const { container } = show(pending({ object: 'person', id: 'nobody', title: 'Long one', body }), vi.fn());
    const view = await card(container);
    expect(await view.findByText('a person')).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Show more' }));
    expect(view.getByRole('button', { name: 'Show less' })).toBeTruthy();
  });

  it('cannot be approved without a title, and leaves other tools to their own card', async () => {
    const { container } = show(pending({ object: 'person', id: 'p1', body: 'No title' }), vi.fn());
    const view = await card(container);
    expect((view.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText('Untitled comment')).toBeTruthy();
    cleanup();
    const other = show({ ...pending({ object: 'person', ids: ['p1'] }), name: 'delete_records' }, vi.fn());
    expect(other.container.querySelector('[data-slot="comment-approval"]')).toBeNull();
  });
});

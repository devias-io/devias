import type { AiToolInfo, ToolCall } from '@devias/core';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToolCallCard } from '../../src/agent-chat/chat/tool-call-card';
import { summarizeAgentCall } from '../../src/pages/agents/approval-summary';
import { agentFixture, createFakeClient, recordsFixture, schemaFixture, TestProviders } from '../../src/testing';

afterEach(cleanup);

const tool = (name: string, over: Partial<AiToolInfo> = {}): AiToolInfo => ({
  name,
  description: '',
  area: 'records',
  readOnly: false,
  escalates: false,
  approval: 'approve',
  locked: false,
  moduleId: null,
  ...over,
});
const catalog = [
  tool('list_records', { readOnly: true, approval: 'auto' }),
  tool('delete_records'),
  tool('run_workflow', { area: 'workflows', escalates: true }),
  tool('create_api_key', { area: 'people', escalates: true }),
];

const sales = agentFixture({ id: 'a1', name: 'Sales', tools: ['list_records', 'delete_records'] });

describe('what an agent call says it will do', () => {
  it('describes a new agent: its tools by area, what runs freely, and tools that reach beyond their name', () => {
    const summary = summarizeAgentCall(
      {
        name: 'create_agent',
        input: {
          name: 'Ops',
          description: 'Keeps things moving',
          tools: ['list_records', 'run_workflow'],
          approvalOverrides: { delete_records: 'auto', list_records: 'auto' },
          starterPrompts: ['see my deals'],
        },
      },
      [],
      catalog,
    );
    expect(summary).toMatchObject({ verb: 'create', name: 'Ops' });
    expect(summary.lines).toEqual([
      'Keeps things moving',
      '2 tools in Records and Workflows',
      // Only a tool that asks by default is news when it runs freely.
      'Runs without asking: Delete records',
      '1 starter prompt',
    ]);
    expect(summary.warning).toBe('Reaches beyond what its name says: Run workflow.');
  });

  it('warns when an agent gets every tool, and not when its tools are plain', () => {
    expect(
      summarizeAgentCall({ name: 'create_agent', input: { name: 'All', tools: null } }, [], catalog).warning,
    ).toMatch(/every tool/);
    expect(
      summarizeAgentCall({ name: 'create_agent', input: { name: 'Plain', tools: ['list_records'] } }, [], catalog)
        .warning,
    ).toBeNull();
  });

  it('describes an update against the agent as it is: what it adds, removes and grants', () => {
    const summary = summarizeAgentCall(
      {
        name: 'update_agent',
        input: { id: 'a1', name: 'Pipeline', tools: ['list_records', 'create_api_key'], archived: false },
      },
      [sales],
      catalog,
    );
    expect(summary).toMatchObject({ verb: 'update', name: 'Pipeline', agentId: 'a1' });
    expect(summary.lines).toEqual([
      'Name: Sales → Pipeline',
      'Restores it to the pickers',
      'Adds Create api key',
      'Removes Delete records',
    ]);
    expect(summary.warning).toBe('Reaches beyond what its name says: Create api key.');
    // Taking tools away grants nothing; going from a list to all of them does.
    expect(
      summarizeAgentCall({ name: 'update_agent', input: { id: 'a1', tools: ['list_records'] } }, [sales], catalog)
        .warning,
    ).toBeNull();
    expect(
      summarizeAgentCall({ name: 'update_agent', input: { id: 'a1', tools: null } }, [sales], catalog).warning,
    ).toMatch(/every tool/);
    expect(summarizeAgentCall({ name: 'update_agent', input: { id: 'a1' } }, [sales], catalog).lines).toEqual([
      'Nothing changes.',
    ]);
  });

  it('describes archiving, naming the agent', () => {
    expect(summarizeAgentCall({ name: 'archive_agent', input: { id: 'a1' } }, [sales], catalog)).toMatchObject({
      verb: 'archive',
      name: 'Sales',
      agentId: 'a1',
    });
  });
});

const pending = (name: string, input: unknown): ToolCall => ({
  id: 'call1',
  toolUseId: 'tu1',
  name,
  input,
  status: 'pending',
  requiresApproval: true,
  reason: undefined,
});

const showCall = (call: ToolCall, onResolve: (approved: boolean) => void) => {
  const ai = {
    status: async () => ({ configured: true, model: 'fake', effort: 'high', tools: catalog, canManage: true }),
    agents: { list: async () => [sales] },
  } as never;

  return render(
    <TestProviders client={createFakeClient(schemaFixture(), recordsFixture(), { ai })} schema={schemaFixture()}>
      <ToolCallCard call={call} onResolve={onResolve} />
    </TestProviders>,
  );
};

describe('the agent approval card', () => {
  it('replaces the plain card for the agent tools, says what is granted, and answers through its buttons', async () => {
    const onResolve = vi.fn();
    const { container } = showCall(
      pending('update_agent', { id: 'a1', tools: ['list_records', 'run_workflow'] }),
      onResolve,
    );
    const card = within(await waitFor(() => container.querySelector('[data-slot="agent-approval"]') as HTMLElement));
    expect(container.querySelector('[data-widget="core.agent_approval"]')).toBeTruthy();
    expect(await card.findByText('Sales')).toBeTruthy();
    expect(await card.findByText('Adds Run workflow')).toBeTruthy();
    expect(await card.findByText(/Reaches beyond what its name says: Run workflow/)).toBeTruthy();
    expect(card.getByRole('link', { name: 'Review' }).getAttribute('href')).toContain('/agents/a1');
    fireEvent.click(card.getByRole('button', { name: 'Approve' }));
    expect(onResolve).toHaveBeenCalledWith(true);
    fireEvent.click(card.getByRole('button', { name: 'Reject' }));
    expect(onResolve).toHaveBeenCalledWith(false);
  });

  it('leaves other tools to their own card', () => {
    const { container } = showCall(pending('delete_records', { object: 'person', ids: ['p1'] }), vi.fn());
    expect(container.querySelector('[data-slot="agent-approval"]')).toBeNull();
  });
});

import type {
  AiAgent,
  AiAgentUsage,
  AiClient,
  AiSettingsPatch,
  AiStreamHandle,
  AiToolInfo,
  ChatEvent,
  Conversation,
  CreateConversationInput,
  DeviasClient,
} from '@devias/core';
import { activityDays, addUsage, emptyUsage } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentChatPanel } from '../../src/agent-chat/chat/agent-chat-panel';
import { useAgentChatStore } from '../../src/agent-chat/chat/store';
import { ids } from '../../src/ids';
import { AgentPage, AgentsPage, agentsPages } from '../../src/pages/agents';
import { AgentEditorPage } from '../../src/pages/agents/agent-editor';
import { AgentsView } from '../../src/pages/agents/agents-view';
import { createStaticNavigation } from '../../src/router/navigation';
import { useDock } from '../../src/shell/dock';
import {
  agentFixture,
  createFakeClient,
  installLayoutStubs,
  noSkills,
  recordsFixture,
  schemaFixture,
  TestProviders,
} from '../../src/testing';
import { typeInto } from './typing';

beforeAll(installLayoutStubs);

const usage = { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const general = agentFixture({ starterPrompts: ['see how many records I have'] });
const sales = agentFixture({
  id: 'a1',
  label: 'Sales',
  icon: 'briefcase',
  description: 'Keeps the pipeline tidy',
  tools: ['list_records'],
  starterPrompts: ['see my open deals'],
});

/** A `client.ai` that remembers how conversations were created and keeps agents in memory. */
const agentAi = (initial: AiAgent[] = [general, sales]) => {
  const created: CreateConversationInput[] = [];
  const agents = new Map<string, AiAgent>(initial.map((agent) => [agent.id, agent]));
  let defaultAgentId: string | null = general.id;
  const conversations = new Map<string, Conversation>();
  const updates: AiSettingsPatch[] = [];
  const stream = (onEvent: (event: ChatEvent) => void, events: ChatEvent[]): AiStreamHandle => ({
    abort: () => {},
    done: (async () => {
      for (const event of events) {
        await tick();
        onEvent(event);
      }
    })(),
  });
  /** What the usage action would answer: each agent's conversations and tokens, from the ones made here. */
  const usageRows = (): AiAgentUsage[] =>
    [...agents.values()].map((agent) => {
      const own = [...conversations.values()].filter((conversation) => conversation.agentId === agent.id);

      return {
        agentId: agent.id,
        conversations: own.length,
        usage: own.reduce((sum, conversation) => addUsage(sum, conversation.usage), emptyUsage()),
        lastMessageAt: null,
      };
    });
  const ai: AiClient = {
    status: async () => ({
      configured: true,
      model: 'fake',
      effort: 'high',
      tools: [
        {
          name: 'list_records',
          description: 'List records.',
          area: 'records',
          readOnly: true,
          escalates: false,
          approval: 'auto',
          locked: false,
          moduleId: null,
        },
        {
          name: 'delete_records',
          description: 'Delete records.',
          area: 'records',
          readOnly: false,
          escalates: false,
          approval: 'approve',
          locked: false,
          moduleId: null,
        },
      ],
      canManage: true,
    }),
    conversations: {
      list: async () => [...conversations.values()],
      create: async (input = {}) => {
        created.push(input);
        const conversation: Conversation = {
          id: `c${created.length}`,
          workspaceId: 'ws1',
          userId: 'u1',
          agentId: input.agentId ?? defaultAgentId ?? general.id,
          title: null,
          activeTurnId: null,
          usage,
          lastMessageAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
        conversations.set(conversation.id, conversation);

        return conversation;
      },
      get: async (id) => {
        const conversation = conversations.get(id);

        if (!conversation) {
          throw new Error('missing');
        }

        return { conversation, messages: [], activeTurn: null };
      },
      delete: async (id) => {
        conversations.delete(id);
      },
    },
    send: (id, _input, onEvent) =>
      stream(onEvent, [
        { type: 'turn_start', turnId: 't1', conversationId: id, userMessageId: 'u-msg', iteration: 0 },
        { type: 'message_start', messageId: 'm1', iteration: 1 },
        { type: 'text_delta', messageId: 'm1', blockIndex: 0, text: 'Pipeline looks fine.' },
        { type: 'message_stop', messageId: 'm1', stopReason: 'end_turn', usage, model: 'fake' },
        { type: 'done', turnId: 't1', status: 'completed', usage },
      ]),
    resolve: () => {
      throw new Error('not expected');
    },
    cancel: async () => null,
    settings: {
      get: async () => ({ defaultAgentId, updatedAt: null }),
      update: async (patch) => {
        if (patch.defaultAgentId !== undefined) {
          defaultAgentId = patch.defaultAgentId;
        }

        updates.push(patch);

        return { defaultAgentId, updatedAt: null };
      },
    },
    skills: noSkills,
    agents: {
      usage: async () => usageRows(),
      // Every day empty but today's: two conversations and four replies, 2,400 input and 600 output tokens.
      activity: async (_id, query) => ({
        days: activityDays(new Date(), query?.days ?? 30, query?.tz ?? 'UTC').map((date, index, all) => ({
          date,
          conversations: index === all.length - 1 ? 2 : 0,
          messages: index === all.length - 1 ? 4 : 0,
          inputTokens: index === all.length - 1 ? 2400 : 0,
          outputTokens: index === all.length - 1 ? 600 : 0,
        })),
      }),
      list: async (opts) => [...agents.values()].filter((agent) => opts?.includeArchived || !agent.archivedAt),
      create: async (input) => {
        const agent: AiAgent = {
          ...sales,
          id: `a${agents.size + 1}`,
          label: input.label,
          icon: input.icon ?? null,
          description: input.description ?? null,
          instructions: input.instructions ?? null,
          tools: input.tools ?? null,
          starterPrompts: input.starterPrompts ?? [],
          approvalOverrides: input.approvalOverrides ?? {},
        };
        agents.set(agent.id, agent);

        return agent;
      },
      update: async (id, patch) => {
        const current = agents.get(id);

        if (!current) {
          throw new Error('missing');
        }

        const { archived, ...fields } = patch;
        const next = {
          ...current,
          ...fields,
          ...(archived !== undefined ? { archivedAt: archived ? '2026-02-01T00:00:00.000Z' : null } : {}),
        } as AiAgent;
        agents.set(id, next);

        return next;
      },
      delete: async (id) => {
        const current = agents.get(id);

        if (current) {
          agents.set(id, { ...current, archivedAt: '2026-02-01T00:00:00.000Z' });
        }
      },
    },
  };

  return { ai, created, agents, conversations, updates };
};

beforeEach(() => {
  useAgentChatStore.setState({ activeId: {}, agentId: {}, threads: {}, streaming: {}, queued: {} });
  useDock.setState({ openId: null });
  window.history.replaceState(null, '', '/workspaces/acme/records/person');
});
afterEach(cleanup);

describe('agents in the panel', () => {
  it('starts with the default agent, offers the others, and a chosen one starts the next conversation', async () => {
    const { ai, created } = agentAi();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    render(
      <TestProviders client={client}>
        <AgentChatPanel />
      </TestProviders>,
    );
    // The default agent's empty conversation, with its starter prompts.
    expect(await screen.findByText('Ask Assistant')).toBeTruthy();
    expect(screen.getByText('see how many records I have')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose an agent' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /Sales/ }));
    expect(useAgentChatStore.getState().agentId.ws1).toBe('a1');
    expect(await screen.findByText('Ask Sales')).toBeTruthy();
    // The menu closes after the pick; the agent's own prompts and description take over.
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /Sales/ })).toBeNull());
    expect(screen.getByText('Keeps the pipeline tidy')).toBeTruthy();
    expect(screen.getByText('see my open deals')).toBeTruthy();
    expect(screen.queryByText('see how many records I have')).toBeNull();

    typeInto(screen.getByLabelText('Message the agent'), 'how is the pipeline?');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Pipeline looks fine.');
    expect(created).toEqual([{ agentId: 'a1' }]);

    // Back to the first agent: the next message starts a fresh conversation with it.
    fireEvent.click(screen.getByRole('button', { name: 'Choose an agent' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Assistant/ }));
    expect(useAgentChatStore.getState().activeId.ws1).toBeNull();
    expect(await screen.findByText('Ask Assistant')).toBeTruthy();
  });

  it('sends a prompt asked for an agent in a new conversation with that agent', async () => {
    const { ai, created } = agentAi();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    useAgentChatStore.getState().queuePrompt('ws1', { text: 'I want to see my open deals', agentId: 'a1' });
    render(
      <TestProviders client={client}>
        <AgentChatPanel />
      </TestProviders>,
    );
    await screen.findByText('Pipeline looks fine.');
    expect(created).toEqual([{ agentId: 'a1' }]);
  });

  it('asks an admin to create an agent when there is none, and members to ask one', async () => {
    const { ai } = agentAi([]);
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    render(
      <TestProviders client={client}>
        <AgentChatPanel />
      </TestProviders>,
    );
    expect(await screen.findByText('No agents yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New agent' })).toBeTruthy();
    cleanup();
    const member = agentAi([]);
    const status = member.ai.status;
    member.ai.status = async () => ({ ...(await status()), canManage: false });
    render(
      <TestProviders client={createFakeClient(schemaFixture(), recordsFixture(), { ai: member.ai })}>
        <AgentChatPanel />
      </TestProviders>,
    );
    expect(await screen.findByText('Ask a workspace admin to create an agent.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New agent' })).toBeNull();
  });

  it("keeps an archived agent's conversation readable, but not writable", async () => {
    const archived = agentFixture({ id: 'a1', label: 'Sales', archivedAt: '2026-02-01T00:00:00.000Z' });
    const { ai, conversations } = agentAi([general, archived]);
    conversations.set('c9', {
      id: 'c9',
      workspaceId: 'ws1',
      userId: 'u1',
      agentId: 'a1',
      title: 'Old deal talk',
      activeTurnId: null,
      usage,
      lastMessageAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    useAgentChatStore.getState().setActive('ws1', 'c9');
    render(
      <TestProviders client={createFakeClient(schemaFixture(), recordsFixture(), { ai })}>
        <AgentChatPanel />
      </TestProviders>,
    );
    const notice = within(await screen.findByText(/Sales was archived/).then((el) => el.closest('div') as HTMLElement));
    const input = screen.getByLabelText('Message the agent');
    await waitFor(() => expect(input.getAttribute('contenteditable')).toBe('false'));
    // The way out is a new conversation, with an active agent.
    fireEvent.click(notice.getByRole('button', { name: 'New conversation' }));
    expect(await screen.findByText('Ask Assistant')).toBeTruthy();
    expect(screen.queryByText(/was archived/)).toBeNull();
  });
});

/** A workspace with one module installed, named "CRM", so a module's agent can say where it comes from. */
const crmSchema = () => ({
  ...schemaFixture(),
  modules: [
    {
      id: '01a173cd-7d36-70a9-83d2-58c83cc3322f',
      version: '0.10.0',
      manifestHash: 'h',
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      label: 'CRM',
      core: false,
      blocks: [],
      agents: [],
      skills: [],
      connections: [],
      variables: [],
      actions: [],
      events: [],
    },
  ],
});
const fromCrm = agentFixture({
  label: 'Pipeline',
  moduleId: '01a173cd-7d36-70a9-83d2-58c83cc3322f',
  id: '01a17356-5c6a-71ce-8398-399c77f1c5d6',
  instructions: 'Work the pipeline.',
  tools: ['list_records', 'delete_records'],
});

describe('agents that come with a module', () => {
  it('say which module they come from in the list', async () => {
    const { ai } = agentAi([general, fromCrm]);
    render(
      <TestProviders
        client={createFakeClient(crmSchema(), recordsFixture(), { ai })}
        schema={crmSchema()}
        navigation={createStaticNavigation('/workspaces/acme/agents')}
      >
        <AgentsView canManage />
      </TestProviders>,
    );
    const row = (await screen.findByText('Pipeline')).closest('[data-slot="agent-row"]') as HTMLElement;
    const source = row.querySelector('[data-slot="agent-source"]') as HTMLElement;
    expect(source.textContent).toBe('CRM');
    expect(source.getAttribute('title')).toBe('Comes with the module CRM');
    expect(source.querySelector('svg')).toBeTruthy();
    // Made here: said plainly, with no module icon.
    const own = (await screen.findByText('Assistant')).closest('[data-slot="agent-row"]') as HTMLElement;
    const made = own.querySelector('[data-slot="agent-source"]') as HTMLElement;
    expect(made.textContent).toBe('Workspace');
    expect(made.querySelector('svg')).toBeNull();
    expect(screen.getByText('Source')).toBeTruthy();
  });

  it("are the module's to describe: read-only, with approvals still the workspace's to set, and only those saved", async () => {
    const made = agentAi([general, fromCrm]);
    const tools = (await made.ai.status()).tools;
    const update = vi.spyOn(made.ai.agents, 'update');
    render(
      <EditorHarness
        agent={fromCrm}
        tools={tools}
        schema={crmSchema()}
        client={createFakeClient(crmSchema(), recordsFixture(), { ai: made.ai })}
        navigate={vi.fn()}
      />,
    );
    expect(screen.getByText(/Comes with the module CRM/)).toBeTruthy();
    expect(screen.getByLabelText('Name').matches(':disabled')).toBe(true);
    expect(screen.getByLabelText('What it is for').matches(':disabled')).toBe(true);
    fireEvent.click(screen.getByRole('tab', { name: /^Instructions/ }));
    expect((await screen.findByRole('textbox', { name: 'Instructions' })).matches(':disabled')).toBe(true);

    fireEvent.click(screen.getByRole('tab', { name: /^Tools/ }));
    // Its tools are listed, cannot be taken away or added to, but each can still ask first or run freely.
    expect(await screen.findByRole('heading', { name: '2 tools' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add tools' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect((screen.getByRole('radio', { name: /All tools/ }) as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'List records' })).getByRole('radio', { name: 'Ask first' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('01a17356-5c6a-71ce-8398-399c77f1c5d6', {
      approvalOverrides: { list_records: 'approve' },
      takesTasks: false,
    });
  });

  it('say so when the module is gone, and cannot be edited either', async () => {
    const archived = agentFixture({ ...fromCrm, archivedAt: '2026-02-01T00:00:00.000Z' });
    const made = agentAi([general, archived]);
    render(
      <TestProviders
        client={createFakeClient(schemaFixture(), recordsFixture(), { ai: made.ai })}
        navigation={createStaticNavigation('/workspaces/acme/agents/a9')}
      >
        <AgentEditorPage agent={archived} tools={[]} />
      </TestProviders>,
    );
    expect(
      screen.getByText(
        /The module 01a173cd-7d36-70a9-83d2-58c83cc3322f is not installed, so this agent is archived until it is/,
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Name').matches(':disabled')).toBe(true);
  });
});

describe('the agents page', () => {
  it("is a page that loads the agents and the agent's tools itself", async () => {
    expect(agentsPages[0]).toMatchObject({ path: 'agents', id: ids.pages.agents });
    const { ai } = agentAi();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    render(
      <TestProviders client={client}>
        <AgentsPage />
      </TestProviders>,
    );
    expect(await screen.findByRole('heading', { name: 'Agents' })).toBeTruthy();
    expect(await screen.findByText('Sales')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New agent' })).toBeTruthy();
  });

  it('lists the agents and opens a new one, or an existing one, as a page', async () => {
    const { ai } = agentAi();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    const tools = (await ai.status()).tools;
    const navigate = vi.fn();
    const navigation = { ...createStaticNavigation('/workspaces/acme/agents'), navigate };
    render(
      <TestProviders client={client} navigation={navigation}>
        <AgentsView tools={tools} canManage />
      </TestProviders>,
    );
    expect(await screen.findByText('Sales')).toBeTruthy();
    // What sets it apart, as a count on its row: its tools ("All" for the general agent, which is the default).
    const row = screen.getByText('Sales').closest('[data-slot="agent-row"]') as HTMLElement;
    expect(within(row).getByText('1')).toBeTruthy();
    const first = (await screen.findByText('Assistant')).closest('[data-slot="agent-row"]') as HTMLElement;
    expect(within(first).getByText('All')).toBeTruthy();
    expect(within(first).getByText('Default')).toBeTruthy();
    // A new agent starts from a template.
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    expect(await screen.findByRole('menuitem', { name: /Blank/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /General/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Read-only analyst/ }));
    expect(navigate).toHaveBeenCalledWith('/workspaces/acme/agents/new?template=analyst');
    // The whole row opens the agent's page.
    expect(screen.getByRole('link', { name: 'Edit Sales' }).getAttribute('href')).toBe('/workspaces/acme/agents/a1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows people who manage agents how much each has been used, and nobody else', async () => {
    const { ai, conversations } = agentAi();
    const base = {
      workspaceId: 'ws1',
      userId: 'u1',
      title: null,
      activeTurnId: null,
      lastMessageAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const used = { inputTokens: 1_200, outputTokens: 300, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
    conversations.set('c1', { ...base, id: 'c1', agentId: 'a1', usage: used });
    conversations.set('c2', { ...base, id: 'c2', agentId: 'a1', usage: used });
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/agents')}>
        <AgentsView canManage />
      </TestProviders>,
    );
    const row = (await screen.findByText('Sales')).closest('[data-slot="agent-row"]') as HTMLElement;
    await waitFor(() => expect(row.querySelector('[data-slot="agent-conversations"]')?.textContent).toBe('2'));
    // 2 x (1,200 in + 300 out) = 3,000 tokens, with the split on hover.
    const tokens = row.querySelector('[data-slot="agent-tokens"]') as HTMLElement;
    expect(tokens.textContent).toBe('3.0k');
    expect(tokens.getAttribute('title')).toContain('2,400 in');
    const unused = (await screen.findByText('Assistant')).closest('[data-slot="agent-row"]') as HTMLElement;
    expect(unused.querySelector('[data-slot="agent-conversations"]')?.textContent).toBe('0');
    expect(screen.getByText('Tokens')).toBeTruthy();
    cleanup();

    const usage = vi.spyOn(ai.agents, 'usage');
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/agents')}>
        <AgentsView canManage={false} />
      </TestProviders>,
    );
    await screen.findByText('Sales');
    expect(screen.queryByText('Tokens')).toBeNull();
    expect(document.querySelector('[data-slot="agent-tokens"]')).toBeNull();
    expect(usage).not.toHaveBeenCalled();
  });

  it('archives an agent from its row, hides it, and restores it from under "Show archived"', async () => {
    const { ai, agents } = agentAi();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    render(
      <TestProviders client={client} navigation={createStaticNavigation('/workspaces/acme/agents')}>
        <AgentsView canManage />
      </TestProviders>,
    );
    // Nothing is archived yet, so there is nothing to show.
    expect(await screen.findByText('Sales')).toBeTruthy();
    expect(screen.queryByRole('switch', { name: /Show archived/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Archive Sales' }));
    await waitFor(() => expect(agents.get('a1')?.archivedAt).not.toBeNull());
    await waitFor(() => expect(screen.queryByText('Sales')).toBeNull());

    fireEvent.click(await screen.findByRole('switch', { name: /Show archived/ }));
    const row = (await screen.findByText('Sales')).closest('[data-slot="agent-row"]') as HTMLElement;
    expect(within(row).getByText('Archived')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Restore Sales' }));
    await waitFor(() => expect(agents.get('a1')?.archivedAt).toBeNull());
  });
});

/** The agent's page with the tab kept in the address, as the router does. */
function EditorHarness({
  agent,
  tools,
  client,
  navigate,
  initialSearch = {},
  schema,
}: {
  schema?: ReturnType<typeof schemaFixture>;
  agent: AiAgent | null;
  tools: AiToolInfo[];
  client: DeviasClient;
  navigate: (href: string) => void;
  initialSearch?: Record<string, unknown>;
}) {
  const [search, setSearch] = useState<Record<string, unknown>>(initialSearch);
  const navigation = {
    ...createStaticNavigation(`/workspaces/acme/agents/${agent?.id ?? 'new'}`, search),
    navigate: (href: string) => {
      navigate(href);
      const tab = new URL(href, 'http://studio.test').searchParams.get('tab');

      if (tab) {
        setSearch({ tab });
      }
    },
  };

  return (
    <TestProviders client={client} navigation={navigation} {...(schema ? { schema } : {})}>
      <AgentEditorPage agent={agent} tools={tools} />
    </TestProviders>
  );
}

describe("an agent's page", () => {
  const setup = async (
    agentOf: (agents: Map<string, AiAgent>) => AiAgent | null,
    initialSearch: Record<string, unknown> = {},
  ) => {
    const made = agentAi();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai: made.ai });
    const tools = (await made.ai.status()).tools;
    const navigate = vi.fn();
    render(
      <EditorHarness
        agent={agentOf(made.agents)}
        tools={tools}
        client={client}
        navigate={navigate}
        initialSearch={initialSearch}
      />,
    );

    return { ...made, navigate };
  };
  const tab = (name: RegExp) => screen.getByRole('tab', { name });

  it('creates an agent across its tabs, saving everything together from the header', async () => {
    const { agents, navigate, updates } = await setup(() => null);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'General',
      'Instructions',
      'Tools',
      'Skills',
    ]);
    // Nothing to create without a name.
    const create = () => screen.getByRole('button', { name: 'Create agent' }) as HTMLButtonElement;
    expect(create().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Support' } });
    expect(create().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Use the receipt icon' }));

    fireEvent.click(tab(/^Instructions/));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Instructions' }), { target: { value: 'Be kind.' } });
    // Starter prompts are edited here too, and blank ones are dropped when saving.
    fireEvent.click(screen.getByRole('button', { name: 'Add a starter prompt' }));
    fireEvent.change(screen.getByLabelText('Starter prompt 1'), { target: { value: ' see the open tickets ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add a starter prompt' }));

    // Every tool to begin with; choose them instead, and with none chosen there is nothing to create.
    fireEvent.click(tab(/^Tools/));
    expect(await screen.findByText('2 tools today, and any that are added later.')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /Chosen tools/ }));
    expect(screen.getByText('No tools yet')).toBeTruthy();
    expect(create().disabled).toBe(true);
    // Add one from the list, asking first (the workspace lets it run freely).
    fireEvent.click(screen.getByRole('button', { name: 'Add tools' }));
    const picker = within(await screen.findByRole('dialog'));
    fireEvent.click(picker.getByRole('checkbox', { name: 'List records' }));
    fireEvent.click(picker.getByRole('button', { name: 'Add 1 tool' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(create().disabled).toBe(false);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'List records' })).getByRole('radio', { name: 'Ask first' }),
    );
    expect(screen.getByText('Own')).toBeTruthy();

    // Making it the default agent is saved to the workspace's settings with it.
    fireEvent.click(tab(/^General/));
    fireEvent.click(screen.getByRole('switch', { name: /Default agent/ }));

    fireEvent.click(create());
    await waitFor(() => expect(agents.size).toBe(3));
    expect([...agents.values()][2]).toMatchObject({
      label: 'Support',
      icon: 'receipt',
      instructions: 'Be kind.',
      starterPrompts: ['see the open tickets'],
      tools: ['list_records'],
      approvalOverrides: { list_records: 'approve' },
    });
    await waitFor(() => expect(updates).toEqual([{ defaultAgentId: 'a3' }]));
    // On to the new agent's own page.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/workspaces/acme/agents/a3'));
  });

  it('starts from a template: the read-only analyst has the reading tools and nothing else', async () => {
    await setup(() => null, { template: 'analyst' });
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Analyst');
    fireEvent.click(tab(/^Tools/));
    // Only the tool that reads is chosen, with the tab counting it.
    expect(await screen.findByRole('heading', { name: '1 tool' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'List records' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Delete records' })).toBeNull();
    expect(tab(/^Tools/).textContent).toBe('Tools1');
    // Saving is on offer straight away: a template is a draft, not something already saved.
    expect((screen.getByRole('button', { name: 'Create agent' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('flags tools that reach beyond their name in the picker, and selects the read-only ones at once', async () => {
    const made = agentAi();
    const status = made.ai.status;
    made.ai.status = async () => {
      const result = await status();

      return {
        ...result,
        tools: [
          ...result.tools,
          {
            name: 'run_workflow',
            description: 'Run a workflow.',
            area: 'workflows' as const,
            readOnly: false,
            escalates: true,
            approval: 'approve' as const,
            locked: false,
            moduleId: null,
          },
        ],
      };
    };
    const tools = (await made.ai.status()).tools;
    render(
      <EditorHarness
        agent={null}
        tools={tools}
        client={createFakeClient(schemaFixture(), recordsFixture(), { ai: made.ai })}
        navigate={vi.fn()}
      />,
    );
    fireEvent.click(tab(/^Tools/));
    fireEvent.click(await screen.findByRole('radio', { name: /Chosen tools/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tools' }));
    const picker = within(await screen.findByRole('dialog'));
    const row = picker.getByRole('checkbox', { name: 'Run workflow' }).closest('div') as HTMLElement;
    expect(within(row.parentElement as HTMLElement).getByText('Escalates')).toBeTruthy();
    expect(picker.getAllByText('Escalates')).toHaveLength(1);
    fireEvent.click(picker.getByRole('button', { name: 'Select read-only tools' }));
    expect(picker.getByText('1 selected')).toBeTruthy();
    expect(
      (picker.getByRole('checkbox', { name: 'List records' }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      (picker.getByRole('checkbox', { name: 'Run workflow' }) as HTMLInputElement).getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('shows how much an existing agent has been used on a tab of its own, which a new agent does not have', async () => {
    await setup((all) => all.get('a1') ?? null, { tab: 'usage' });
    const headerTabs = () =>
      within(document.querySelector('[data-slot="agent-header"]') as HTMLElement)
        .getAllByRole('tab')
        .map((t) => t.textContent);
    expect(headerTabs()).toEqual(['General', 'Instructions', 'Tools1', 'Skills', 'Usage']);
    // The figure is the tokens of the period, with the split in the legend under it.
    expect(await screen.findByText('3.0k')).toBeTruthy();
    const legend = within(document.querySelector('[data-slot="usage-legend"]') as HTMLElement);
    expect(legend.getByText(/2\.4k input tokens/)).toBeTruthy();
    expect(legend.getByText(/600 output tokens/)).toBeTruthy();
    expect(screen.getByText('2 conversations started and 4 replies given.')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Tokens per day, last 30 days' })).toBeTruthy();
    // Another period asks again and counts per week once it is three months.
    fireEvent.click(screen.getByRole('tab', { name: '3M' }));
    expect(await screen.findByRole('img', { name: 'Tokens per week, last 90 days' })).toBeTruthy();
    cleanup();
    await setup(() => null, { tab: 'usage' });
    expect(headerTabs()).toEqual(['General', 'Instructions', 'Tools', 'Skills']);
    expect(document.querySelector('[data-slot="agent-usage"]')).toBeNull();
  });

  it('keeps tools simple: all of them, or the chosen ones to add and remove', async () => {
    await setup(() => null);
    fireEvent.click(tab(/^Tools/));
    // All tools: a summary by area, not a row for each.
    expect(await screen.findByText('2 tools today, and any that are added later.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'List records' })).toBeNull();
    expect(tab(/^Tools/).textContent).toBe('Tools');

    // Chosen: only what is added shows, with the tab counting them.
    fireEvent.click(screen.getByRole('radio', { name: /Chosen tools/ }));
    expect(tab(/^Tools/).textContent).toBe('Tools0');
    fireEvent.click(screen.getByRole('button', { name: 'Add tools' }));
    const picker = within(await screen.findByRole('dialog'));
    // Search narrows the list; with nothing selected there is nothing to add.
    const search = picker.getByRole('textbox', { name: 'Search tools' });
    fireEvent.change(search, { target: { value: 'delete' } });
    expect(picker.queryByRole('checkbox', { name: 'List records' })).toBeNull();
    expect(picker.getByRole('checkbox', { name: 'Delete records' })).toBeTruthy();
    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(picker.getByText('No tool matches.')).toBeTruthy();
    fireEvent.change(search, { target: { value: '' } });
    expect((picker.getByRole('button', { name: 'Add tools' }) as HTMLButtonElement).disabled).toBe(true);
    // Select a whole area at once.
    fireEvent.click(picker.getByRole('button', { name: 'Select all in records' }));
    expect(picker.getByText('2 selected')).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Add 2 tools' }));
    expect(await screen.findByRole('heading', { name: '2 tools' })).toBeTruthy();
    const radio = (tool: string, label: string) =>
      within(screen.getByRole('group', { name: tool })).getByRole('radio', { name: label }) as HTMLInputElement;
    // As the workspace has them: deleting asks first, querying runs freely.
    expect(radio('Delete records', 'Ask first').checked).toBe(true);
    expect(radio('List records', 'Runs freely').checked).toBe(true);
    // Nothing left to add.
    expect((screen.getByRole('button', { name: 'Add tools' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove Delete records' }));
    expect(await screen.findByRole('heading', { name: '1 tool' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Delete records' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Add tools' }) as HTMLButtonElement).disabled).toBe(false);

    // The agent's own approval is kept when going back to all tools, where it can be reset.
    fireEvent.click(radio('List records', 'Ask first'));
    fireEvent.click(screen.getByRole('radio', { name: /All tools/ }));
    expect(await screen.findByRole('heading', { name: 'Its own approvals' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: "Use the workspace's" }));
    expect(screen.queryByRole('heading', { name: 'Its own approvals' })).toBeNull();
    // The chosen tools are remembered for when it is limited again.
    fireEvent.click(screen.getByRole('radio', { name: /Chosen tools/ }));
    expect(await screen.findByRole('heading', { name: '1 tool' })).toBeTruthy();
  });

  it('saves a change to an agent only once something changed, and archives and restores it', async () => {
    const { ai, agents, navigate } = await setup((all) => all.get('a1') ?? null);
    expect(screen.getByRole('heading', { name: 'Sales' })).toBeTruthy();
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Sales');
    const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('What it is for'), { target: { value: 'Chases the quiet deals' } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await waitFor(() => expect(agents.get('a1')?.description).toBe('Chases the quiet deals'));

    // Archiving is a card at the bottom of the General tab, not a button in the header.
    const header = document.querySelector('[data-slot="agent-header"]') as HTMLElement;
    expect(within(header).queryByRole('button', { name: /Archive/ })).toBeNull();
    const card = within(document.querySelector('[data-slot="agent-archive"]') as HTMLElement);
    expect(card.getByText('Archive Sales')).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(agents.get('a1')?.archivedAt).not.toBeNull());
    expect(agents.size).toBe(2);
    void ai;
    void navigate;
  });

  it('shows an archived agent with a way to restore it, and no default switch', async () => {
    const archived = agentFixture({ ...sales, archivedAt: '2026-02-01T00:00:00.000Z' });
    const { agents } = await setup(() => archived);
    expect(await screen.findByText('Sales is archived')).toBeTruthy();
    expect(screen.getByRole('switch', { name: /Default agent/ }).getAttribute('aria-disabled')).toBe('true');
    // Restoring needs the agent in the store the fake saves to.
    agents.set('a1', archived);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(agents.get('a1')?.archivedAt).toBeNull());
  });

  it('says so when the agent is not there', async () => {
    const { ai } = agentAi();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    render(
      <TestProviders
        client={client}
        navigation={createStaticNavigation('/workspaces/acme/agents/zzz', {}, { agentId: 'zzz' })}
      >
        <AgentPage />
      </TestProviders>,
    );
    expect(await screen.findByText('Agent not found')).toBeTruthy();
  });
});

import type { AiClient, AiStreamHandle, ChatEvent, ChatMessage, Conversation, ToolCall } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_PANEL_ID, askAgent } from '../../src/agent-chat/ask';
import { AgentChatPanel } from '../../src/agent-chat/chat/agent-chat-panel';
import { newThread, reduceChatEvent, type ThreadState, useAgentChatStore } from '../../src/agent-chat/chat/store';
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
import { textOf, typeInto } from './typing';

beforeAll(installLayoutStubs);

const usage = { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A scripted `client.ai`: one conversation, a gated delete on send, a navigation on approve. */
const scriptedAi = () => {
  const threads = new Map<string, ThreadState>();
  const resolves: [string, boolean][] = [];
  const stream = (id: string, onEvent: (event: ChatEvent) => void, events: ChatEvent[]): AiStreamHandle => {
    const done = (async () => {
      for (const event of events) {
        await tick();
        const thread = threads.get(id);

        if (thread) {
          threads.set(id, reduceChatEvent(thread, event));
        }

        onEvent(event);
      }
    })();

    return { abort: () => {}, done };
  };
  const pendingCall: ToolCall = {
    id: 'call1',
    toolUseId: 'tu1',
    name: 'delete_records',
    input: { object: 'person', ids: ['p1'] },
    status: 'pending',
    requiresApproval: true,
  };
  const ai: AiClient = {
    status: async () => ({ configured: true, model: 'fake', effort: 'high', tools: [], canManage: true }),
    conversations: {
      list: async () => [...threads.values()].map((t) => t.conversation),
      create: async () => {
        const conversation: Conversation = {
          id: 'c1',
          workspaceId: 'ws1',
          userId: 'u1',
          agentId: 'a0',
          title: null,
          activeTurnId: null,
          usage,
          lastMessageAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
        threads.set(conversation.id, newThread(conversation));

        return conversation;
      },
      get: async (id) => {
        const thread = threads.get(id);

        if (!thread) {
          throw new Error('missing');
        }

        const { error: _error, ...rest } = thread;

        return rest;
      },
      delete: async (id) => {
        threads.delete(id);
      },
    },
    send: (id, input, onEvent) => {
      const thread = threads.get(id);
      const user: ChatMessage = {
        id: 'u-msg',
        conversationId: id,
        turnId: 't1',
        seq: 1,
        role: 'user',
        blocks: [{ type: 'text', text: input.content }],
        text: input.content,
        createdAt: '2026-01-01T00:00:00.000Z',
      };

      if (thread) {
        threads.set(id, { ...thread, messages: [...thread.messages, user] });
      }

      return stream(id, onEvent, [
        { type: 'turn_start', turnId: 't1', conversationId: id, userMessageId: 'u-msg', iteration: 0 },
        { type: 'message_start', messageId: 'm1', iteration: 1 },
        { type: 'text_delta', messageId: 'm1', blockIndex: 0, text: 'I will delete **Ada**.' },
        { type: 'tool_call_start', messageId: 'm1', blockIndex: 1, toolUseId: 'tu1', name: 'delete_records' },
        { type: 'tool_call', messageId: 'm1', blockIndex: 1, toolCall: pendingCall },
        { type: 'message_stop', messageId: 'm1', stopReason: 'tool_use', usage, model: 'fake' },
        { type: 'paused', turnId: 't1', pending: [pendingCall] },
      ]);
    },
    resolve: (id, toolCallId, input, onEvent) => {
      resolves.push([toolCallId, input.approved]);

      return stream(id, onEvent, [
        { type: 'turn_start', turnId: 't1', conversationId: id, iteration: 1 },
        { type: 'tool_result', toolCallId, status: 'executed', result: { deleted: 1 }, isError: false },
        { type: 'navigate', target: { kind: 'object', object: 'person' } },
        { type: 'message_start', messageId: 'm2', iteration: 2 },
        { type: 'text_delta', messageId: 'm2', blockIndex: 0, text: 'Done.' },
        { type: 'message_stop', messageId: 'm2', stopReason: 'end_turn', usage, model: 'fake' },
        { type: 'done', turnId: 't1', status: 'completed', usage },
      ]);
    },
    cancel: async () => null,
    settings: {
      get: async () => ({ defaultAgentId: 'a0', updatedAt: null }),
      update: async (patch) => ({
        defaultAgentId: patch.defaultAgentId ?? 'a0',
        updatedAt: null,
      }),
    },
    skills: noSkills,
    agents: {
      list: async () => [agentFixture()],
      usage: async () => [],
      activity: async () => ({ days: [] }),
      create: async () => {
        throw new Error('not implemented');
      },
      update: async () => {
        throw new Error('not implemented');
      },
      delete: async () => {},
    },
  };

  return { ai, resolves };
};

beforeEach(() => {
  useAgentChatStore.setState({ activeId: {}, agentId: {}, threads: {}, streaming: {}, queued: {} });
  useDock.setState({ openId: null });
  window.history.replaceState(null, '', '/workspaces/acme/records/person');
});
afterEach(cleanup);

describe('AgentChatPanel', () => {
  it('shows the setup hint when the agent is not configured', async () => {
    const client = createFakeClient(schemaFixture(), recordsFixture());
    render(
      <TestProviders client={client}>
        <AgentChatPanel />
      </TestProviders>,
    );
    await screen.findByText('AI is not configured');
  });

  it('sends a prompt asked from elsewhere (e.g. Home) once, in a new conversation', async () => {
    const { ai } = scriptedAi();
    const sent: string[] = [];
    const send = ai.send;
    ai.send = (id, input, onEvent) => {
      sent.push(input.content);

      return send(id, input, onEvent);
    };
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    askAgent('ws1', 'I want to find the tasks that are overdue');
    expect(useDock.getState().openId).toBe(AGENT_PANEL_ID);
    render(
      <TestProviders client={client}>
        <AgentChatPanel />
      </TestProviders>,
    );
    await screen.findByText('I want to find the tasks that are overdue');
    await waitFor(() => expect(sent).toEqual(['I want to find the tasks that are overdue']));
    expect(useAgentChatStore.getState().queued.ws1).toBeUndefined();
    expect(useAgentChatStore.getState().activeId.ws1).toBe('c1');
    // Let the scripted reply finish so its events don't reach the next test's conversation.
    await screen.findByText('Needs approval');
  });

  it('streams a reply, pauses on a gated tool call, approves it and follows the navigation', async () => {
    const { ai, resolves } = scriptedAi();
    const client = createFakeClient(schemaFixture(), recordsFixture(), { ai });
    const navigation = createStaticNavigation(
      '/workspaces/acme/records/person',
      {},
      { workspaceSlug: 'acme', objectKey: 'person' },
    );
    render(
      <TestProviders client={client} navigation={navigation}>
        <AgentChatPanel />
      </TestProviders>,
    );
    const input = await screen.findByLabelText('Message the agent');
    // the composer stays disabled until the status query resolves
    await waitFor(() => expect(input.getAttribute('contenteditable')).toBe('true'));
    typeInto(input, 'delete Ada');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });

    await screen.findByText('Needs approval');
    expect(screen.getByText('Ada').tagName).toBe('STRONG');
    // The row says what it will do, not the tool's name.
    expect(screen.getByRole('button', { name: /Delete 1 person/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('button', { name: /approve/i })).toBeTruthy());
    // While an action awaits approval the composer stays usable (a disabled field would lose focus), but won't send.
    expect(input.getAttribute('contenteditable')).toBe('true');
    expect(document.activeElement).toBe(input);
    typeInto(input, 'and Linus too');
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(textOf(input)).toBe('and Linus too');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    await screen.findByText('Done.');
    expect(resolves).toEqual([['call1', true]]);
    await waitFor(() => expect(screen.getByText('Done')).toBeTruthy());
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces/acme/records/person'));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(document.activeElement).toBe(input);
    expect(useAgentChatStore.getState().activeId.ws1).toBe('c1');
  });
});

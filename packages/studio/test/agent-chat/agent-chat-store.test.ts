import type { ChatEvent, Conversation } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { newThread, pendingCalls, reduceChatEvent } from '../../src/agent-chat/chat/store';
import { pageContextFrom } from '../../src/agent-chat/chat/use-agent-chat';
import { useDock } from '../../src/shell/dock';

const conversation: Conversation = {
  id: 'c1',
  workspaceId: 'ws1',
  userId: 'u1',
  agentId: 'a0',
  title: null,
  activeTurnId: null,
  usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
  lastMessageAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const usage = { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };

describe('reduceChatEvent', () => {
  it('folds a streamed turn with thinking, text and a gated tool call into display blocks', () => {
    const events: ChatEvent[] = [
      { type: 'turn_start', turnId: 't1', conversationId: 'c1', iteration: 0 },
      { type: 'message_start', messageId: 'm1', iteration: 1 },
      { type: 'thinking_delta', messageId: 'm1', blockIndex: 0, text: 'hmm' },
      { type: 'thinking_stop', messageId: 'm1', blockIndex: 0 },
      { type: 'text_delta', messageId: 'm1', blockIndex: 1, text: 'Dele' },
      { type: 'text_delta', messageId: 'm1', blockIndex: 1, text: 'ting.' },
      { type: 'tool_call_start', messageId: 'm1', blockIndex: 2, toolUseId: 'tu1', name: 'delete_records' },
      { type: 'tool_call_input_delta', messageId: 'm1', blockIndex: 2, partialJson: '{"object":' },
      { type: 'tool_call_input_delta', messageId: 'm1', blockIndex: 2, partialJson: '"person"}' },
      {
        type: 'tool_call',
        messageId: 'm1',
        blockIndex: 2,
        toolCall: {
          id: 'call1',
          toolUseId: 'tu1',
          name: 'delete_records',
          input: { object: 'person' },
          status: 'pending',
          requiresApproval: true,
        },
      },
      { type: 'message_stop', messageId: 'm1', stopReason: 'tool_use', usage, model: 'fake' },
      { type: 'paused', turnId: 't1', pending: [] },
    ];
    let thread = newThread(conversation);
    const snapshots = events.map((event) => {
      thread = reduceChatEvent(thread, event);

      return thread;
    });
    // while the input streams, the card shows the partial JSON
    const streaming = snapshots[8]?.messages[0]?.blocks[2];
    expect(streaming).toMatchObject({
      type: 'tool_use',
      toolCall: { input: '{"object":"person"}', name: 'delete_records' },
    });

    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]?.blocks).toEqual([
      { type: 'thinking', text: 'hmm' },
      { type: 'text', text: 'Deleting.' },
      {
        type: 'tool_use',
        toolCall: {
          id: 'call1',
          toolUseId: 'tu1',
          name: 'delete_records',
          input: { object: 'person' },
          status: 'pending',
          requiresApproval: true,
        },
      },
    ]);
    expect(thread.messages[0]).toMatchObject({ partial: false, stopReason: 'tool_use', model: 'fake', usage });
    expect(thread.activeTurn?.status).toBe('awaiting_approval');
    expect(pendingCalls(thread).map((c) => c.id)).toEqual(['call1']);

    thread = reduceChatEvent(thread, { type: 'turn_start', turnId: 't1', conversationId: 'c1', iteration: 1 });
    thread = reduceChatEvent(thread, {
      type: 'tool_result',
      toolCallId: 'call1',
      status: 'executed',
      result: { deleted: 1 },
      isError: false,
    });
    expect(pendingCalls(thread)).toEqual([]);
    expect(thread.messages[0]?.blocks[2]).toMatchObject({ toolCall: { status: 'executed', result: { deleted: 1 } } });

    thread = reduceChatEvent(thread, { type: 'error', code: 'RATE_LIMITED', message: 'slow down', retryable: true });
    thread = reduceChatEvent(thread, { type: 'done', turnId: 't1', status: 'failed', usage });
    expect(thread.activeTurn).toBeNull();
    expect(thread.conversation.activeTurnId).toBeNull();
    expect(thread.conversation.usage.inputTokens).toBe(10);
    expect(thread.error?.code).toBe('RATE_LIMITED');
  });

  it('derives the page context from the route', () => {
    expect(
      pageContextFrom(
        '/workspaces/acme/records/person/p1',
        { workspaceSlug: 'acme', objectKey: 'person', recordId: 'p1' },
        { view: 'v1' },
      ),
    ).toEqual({
      page: { path: 'records/person/p1', object: 'person', recordId: 'p1', viewId: 'v1' },
    });
    expect(
      pageContextFrom('/workspaces/acme/settings/general', { workspaceSlug: 'acme', section: 'general' }, {}),
    ).toEqual({
      page: { path: 'settings/general' },
    });
    expect(pageContextFrom('/workspaces', {}, {})).toEqual({});
  });

  it('docks one panel at a time', () => {
    const dock = useDock.getState();
    dock.toggle('agent-chat');
    expect(useDock.getState().openId).toBe('agent-chat');
    dock.toggle('other');
    expect(useDock.getState().openId).toBe('other');
    dock.toggle('other');
    expect(useDock.getState().openId).toBeNull();
    dock.open('agent-chat');
    dock.close();
    expect(useDock.getState().openId).toBeNull();
  });
});

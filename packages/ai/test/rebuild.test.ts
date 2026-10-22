import { describe, expect, it } from 'vitest';
import { RebuildError, rebuildMessages, serializeResult } from '../src/runtime/rebuild';
import type { MessageRow, ToolCallRow } from '../src/store';

const at = new Date('2026-01-01T00:00:00Z');
const message = (seq: number, role: 'user' | 'assistant', content: unknown[]): MessageRow => ({
  id: `m${seq}`,
  conversationId: 'c1',
  turnId: 't1',
  workspaceId: 'ws',
  seq,
  role,
  content,
  text: null,
  context: null,
  model: null,
  usage: null,
  stopReason: null,
  partial: false,
  createdAt: at,
});
const call = (toolUseId: string, status: ToolCallRow['status'], extra: Partial<ToolCallRow> = {}): ToolCallRow => ({
  id: `call_${toolUseId}`,
  conversationId: 'c1',
  turnId: 't1',
  messageId: 'm2',
  workspaceId: 'ws',
  toolUseId,
  name: 'tool',
  input: {},
  status,
  requiresApproval: false,
  result: null,
  isError: false,
  reason: null,
  inputRequest: null,
  resolvedAt: null,
  executedAt: null,
  createdAt: at,
  ...extra,
});

describe('rebuildMessages', () => {
  it('replays assistant content verbatim and answers parallel tool uses in one user message, in block order', () => {
    const thinking = { type: 'thinking', thinking: 'hmm', signature: 'sig-123' };
    const rows = [
      message(1, 'user', [
        { type: 'text', text: 'hi' },
        { type: 'text', text: '<context>x</context>' },
      ]),
      message(2, 'assistant', [
        thinking,
        { type: 'text', text: 'Doing two things' },
        { type: 'tool_use', id: 'tu1', name: 'a', input: { x: 1 } },
        { type: 'tool_use', id: 'tu2', name: 'b', input: {} },
      ]),
    ];
    const calls = [
      call('tu2', 'failed', { result: { error: { code: 'NOT_FOUND', message: 'nope' } }, isError: true }),
      call('tu1', 'executed', { result: { ok: true } }),
    ];
    const out = rebuildMessages(rows, calls);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'text', text: '<context>x</context>' },
      ],
    });
    expect(out[1]?.role).toBe('assistant');
    expect(out[1]?.content[0]).toBe(thinking);
    expect(out[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: '{"ok":true}' },
        {
          type: 'tool_result',
          tool_use_id: 'tu2',
          content: '{"error":{"code":"NOT_FOUND","message":"nope"}}',
          is_error: true,
        },
      ],
    });
  });

  it('turns rejections, declines and missing rows into error results and merges the next user text after them', () => {
    const rows = [
      message(1, 'user', [{ type: 'text', text: 'delete it' }]),
      message(2, 'assistant', [
        { type: 'tool_use', id: 'tu1', name: 'delete_records', input: {} },
        { type: 'tool_use', id: 'tu2', name: 'delete_records', input: {} },
        { type: 'tool_use', id: 'tu3', name: 'delete_records', input: {} },
      ]),
      message(3, 'user', [{ type: 'text', text: 'never mind' }]),
    ];
    const calls = [call('tu1', 'rejected', { reason: 'wrong one' }), call('tu2', 'declined')];
    const out = rebuildMessages(rows, calls);
    expect(out[2]).toEqual({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu1',
          content: 'The user rejected this action: wrong one',
          is_error: true,
        },
        {
          type: 'tool_result',
          tool_use_id: 'tu2',
          content: '{"declined":true,"message":"This call was cancelled before it ran."}',
          is_error: true,
        },
        { type: 'tool_result', tool_use_id: 'tu3', content: 'This call was cancelled before it ran.', is_error: true },
        { type: 'text', text: 'never mind' },
      ],
    });
  });

  it('refuses to rebuild while a call is still pending and drops empty assistant messages', () => {
    const rows = [
      message(1, 'user', [{ type: 'text', text: 'x' }]),
      message(2, 'assistant', [{ type: 'text', text: '' }]),
      message(3, 'assistant', [{ type: 'tool_use', id: 'tu1', name: 'a', input: {} }]),
    ];
    expect(() => rebuildMessages(rows, [call('tu1', 'pending')])).toThrow(RebuildError);
    const out = rebuildMessages(rows.slice(0, 2), []);
    expect(out).toEqual([{ role: 'user', content: [{ type: 'text', text: 'x' }] }]);
  });

  it('truncates oversized results with a note', () => {
    const big = serializeResult({ rows: 'x'.repeat(70_000) });
    expect(big.length).toBeLessThan(70_100);
    expect(big).toContain('[truncated');
  });
});

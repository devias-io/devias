import {
  type ContentBlock,
  isToolUseBlock,
  type ModelMessage,
  type ToolResultParam,
  type UserBlock,
} from '../model/types';
import type { MessageRow, ToolCallRow } from '../store';

/**
 * Stored rows → the message list for the next model call. Assistant content is replayed verbatim
 * (thinking blocks and signatures intact). Tool results are not stored as messages: they are
 * synthesized from the tool-call rows, one `tool_result` per `tool_use`, in block order, all in the
 * one user message that follows the assistant message. A later user message merges into that same
 * user message (results first, then text), which is what the API requires.
 */

export class RebuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RebuildError';
  }
}

const MAX_RESULT_CHARS = 60_000;

export const serializeResult = (value: unknown): string => {
  const json = value === undefined ? 'null' : JSON.stringify(value);

  if (json.length <= MAX_RESULT_CHARS) {
    return json;
  }

  return `${json.slice(0, MAX_RESULT_CHARS)}… [truncated ${json.length - MAX_RESULT_CHARS} characters; narrow the request]`;
};

export const resultBlockFor = (toolUseId: string, call: ToolCallRow | undefined): ToolResultParam => {
  if (!call) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: 'This call was cancelled before it ran.',
      is_error: true,
    };
  }

  switch (call.status) {
    case 'executed':
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: serializeResult(call.result),
        ...(call.isError ? { is_error: true } : {}),
      };
    case 'failed':
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: serializeResult(call.result ?? { error: 'failed' }),
        is_error: true,
      };
    case 'rejected':
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: `The user rejected this action${call.reason ? `: ${call.reason}` : '.'}`,
        is_error: true,
      };
    case 'declined':
      return {
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: serializeResult(call.result ?? { declined: true, message: 'This call was cancelled before it ran.' }),
        is_error: true,
      };
    default:
      throw new RebuildError(`Tool call ${call.id} (${call.name}) is still ${call.status}; the turn cannot continue`);
  }
};

export const rebuildMessages = (messages: MessageRow[], toolCalls: ToolCallRow[]): ModelMessage[] => {
  const callsByToolUse = new Map(toolCalls.map((c) => [c.toolUseId, c]));
  const out: ModelMessage[] = [];
  let pendingUser: UserBlock[] = [];
  const flushUser = () => {
    if (pendingUser.length === 0) {
      return;
    }

    out.push({ role: 'user', content: pendingUser });
    pendingUser = [];
  };

  for (const row of [...messages].sort((a, b) => a.seq - b.seq)) {
    if (row.role === 'user') {
      for (const block of (row.content ?? []) as UserBlock[]) {
        if (block.type === 'text' && block.text) {
          pendingUser.push({ type: 'text', text: block.text });
        }
      }

      continue;
    }

    const content = ((row.content ?? []) as ContentBlock[]).filter(
      (block) => !(block.type === 'text' && typeof block.text === 'string' && block.text === ''),
    );

    if (content.length === 0) {
      continue;
    }

    flushUser();
    out.push({ role: 'assistant', content });

    for (const block of content) {
      if (isToolUseBlock(block)) {
        pendingUser.push(resultBlockFor(block.id, callsByToolUse.get(block.id)));
      }
    }
  }

  flushUser();

  return out;
};

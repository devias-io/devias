import type { AiUsage } from '@devias/core';

/**
 * The runtime's view of a model: a streaming request that yields events and ends with the final
 * message. `@anthropic-ai/sdk` implements it in production; `testing.ts` scripts it for tests.
 * Content blocks are kept in the API's own shape so a stored assistant message can be replayed
 * verbatim (thinking signatures, fallback markers and all).
 */

export interface TextBlock {
  type: 'text';
  text: string;
  [key: string]: unknown;
}
export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}
export interface RedactedThinkingBlock {
  type: 'redacted_thinking';
  data: string;
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
  [key: string]: unknown;
}
export interface UnknownBlock {
  type: string;
  [key: string]: unknown;
}
/** Anything the model returned. Unknown kinds are stored and replayed untouched. */
export type ContentBlock = TextBlock | ThinkingBlock | RedactedThinkingBlock | ToolUseBlock | UnknownBlock;

export const isTextBlock = (block: ContentBlock): block is TextBlock => block.type === 'text';
export const isThinkingBlock = (block: ContentBlock): block is ThinkingBlock => block.type === 'thinking';
export const isRedactedThinkingBlock = (block: ContentBlock): block is RedactedThinkingBlock =>
  block.type === 'redacted_thinking';
export const isToolUseBlock = (block: ContentBlock): block is ToolUseBlock => block.type === 'tool_use';

export interface TextParam {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}
export interface ToolResultParam {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: { type: 'ephemeral' };
}
export type UserBlock = TextParam | ToolResultParam;

export type ModelMessage = { role: 'user'; content: UserBlock[] } | { role: 'assistant'; content: ContentBlock[] };

export interface ModelToolSpec {
  name: string;
  description: string;
  /** JSON schema (draft 2020-12) with a root `object`. */
  inputSchema: Record<string, unknown>;
}

export interface ModelRequest {
  /** The system prompt for the tools this request carries (stable for one tool set); the adapter marks it as a cache breakpoint. */
  system: string;
  /** An agent's instructions, sent after the system prompt as a second system block (its own cache breakpoint). */
  instructions?: string;
  messages: ModelMessage[];
  /** Sorted by name by the caller so the rendered prompt is stable. */
  tools: ModelToolSpec[];
  signal?: AbortSignal;
  /** Opaque per-user id forwarded as request metadata (abuse detection), never a name or email. */
  userId?: string;
}

export type ModelEvent =
  | { type: 'message_start'; id: string; model: string; usage: AiUsage }
  | { type: 'block_start'; index: number; block: ContentBlock }
  | { type: 'text_delta'; index: number; text: string }
  | { type: 'thinking_delta'; index: number; text: string }
  | { type: 'input_json_delta'; index: number; partialJson: string }
  | { type: 'block_stop'; index: number }
  | { type: 'message_delta'; stopReason: string | null; usage: Partial<AiUsage> }
  | { type: 'message_stop' };

export interface ModelResult {
  id: string;
  model: string;
  content: ContentBlock[];
  stopReason: string | null;
  stopDetails?: unknown;
  usage: AiUsage;
}

export type ModelErrorCode =
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'AUTH'
  | 'INVALID_REQUEST'
  | 'ABORTED'
  | 'INVALID_JSON'
  | 'OVERLOADED'
  | 'INTERNAL';

export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ModelError';
  }
}

export const isModelError = (error: unknown): error is ModelError => error instanceof ModelError;

export interface ModelClient {
  readonly model: string;
  readonly effort: string;
  /** Stream one model call; `onEvent` receives deltas as they arrive, the promise resolves with the final message. */
  stream(request: ModelRequest, onEvent: (event: ModelEvent) => void): Promise<ModelResult>;
}

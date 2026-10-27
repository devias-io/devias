import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent,
  BetaTool,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { AiUsage } from '@devias/core';
import {
  type ContentBlock,
  type ModelClient,
  ModelError,
  type ModelEvent,
  type ModelMessage,
  type ModelRequest,
} from './types';

export interface AnthropicModelOptions {
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  /** Opt into server-side refusal fallbacks (`fallbacks: "default"`, beta). */
  fallbacks: boolean;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  baseURL?: string;
}

/** The beta header that gates the `fallbacks: "default"` scalar form. */
const FALLBACKS_BETA = 'server-side-fallback-2026-07-01';

const usageOf = (usage: BetaUsage | null | undefined): AiUsage => ({
  inputTokens: usage?.input_tokens ?? 0,
  outputTokens: usage?.output_tokens ?? 0,
  cacheReadInputTokens: usage?.cache_read_input_tokens ?? 0,
  cacheCreationInputTokens: usage?.cache_creation_input_tokens ?? 0,
});

/** Mark the last block of the last message as a cache breakpoint so each turn reuses the previous prefix. */
const toApiMessages = (messages: ModelMessage[]): BetaMessageParam[] =>
  messages.map((message, i) => {
    const last = i === messages.length - 1;
    const content = message.content.map((block, j) => {
      const isLastBlock = last && j === message.content.length - 1;
      const cacheable = block.type === 'text' || block.type === 'tool_result';

      return isLastBlock && cacheable
        ? ({ ...block, cache_control: { type: 'ephemeral' } } as unknown as BetaContentBlockParam)
        : (block as unknown as BetaContentBlockParam);
    });

    return { role: message.role, content };
  });

const toApiTools = (tools: ModelRequest['tools']): BetaTool[] =>
  tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as BetaTool['input_schema'],
    eager_input_streaming: true,
  }));

const toModelEvent = (event: BetaRawMessageStreamEvent): ModelEvent | null => {
  switch (event.type) {
    case 'message_start':
      return {
        type: 'message_start',
        id: event.message.id,
        model: event.message.model,
        usage: usageOf(event.message.usage),
      };
    case 'content_block_start':
      return { type: 'block_start', index: event.index, block: event.content_block as unknown as ContentBlock };
    case 'content_block_delta':
      switch (event.delta.type) {
        case 'text_delta':
          return { type: 'text_delta', index: event.index, text: event.delta.text };
        case 'thinking_delta':
          return { type: 'thinking_delta', index: event.index, text: event.delta.thinking };
        case 'input_json_delta':
          return { type: 'input_json_delta', index: event.index, partialJson: event.delta.partial_json };
        default:
          return null;
      }
    case 'content_block_stop':
      return { type: 'block_stop', index: event.index };
    case 'message_delta':
      return {
        type: 'message_delta',
        stopReason: event.delta.stop_reason,
        usage: {
          outputTokens: event.usage.output_tokens,
          ...(event.usage.input_tokens !== null ? { inputTokens: event.usage.input_tokens } : {}),
          ...(event.usage.cache_read_input_tokens !== null
            ? { cacheReadInputTokens: event.usage.cache_read_input_tokens }
            : {}),
          ...(event.usage.cache_creation_input_tokens !== null
            ? { cacheCreationInputTokens: event.usage.cache_creation_input_tokens }
            : {}),
        },
      };
    case 'message_stop':
      return { type: 'message_stop' };
    default:
      return null;
  }
};

/** Map SDK failures to the runtime's error type; anything that is not a typed API error is treated as bad JSON. */
export const toModelError = (error: unknown): ModelError => {
  if (error instanceof ModelError) {
    return error;
  }

  if (error instanceof Anthropic.APIUserAbortError) {
    return new ModelError('ABORTED', 'The request was cancelled', false);
  }

  if (error instanceof Anthropic.RateLimitError) {
    return new ModelError('RATE_LIMITED', 'The model is rate limited; try again shortly', true, 429);
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return new ModelError('NETWORK', `Could not reach the model API: ${error.message}`, true);
  }

  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ModelError('AUTH', 'The model API rejected the credentials', false, error.status);
  }

  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) {
    return new ModelError('INVALID_REQUEST', error.message, false, error.status);
  }

  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 500;
    const overloaded = status === 529 || /overloaded/i.test(error.message);

    return new ModelError(overloaded ? 'OVERLOADED' : 'INTERNAL', error.message, status >= 500, status);
  }

  const message = error instanceof Error ? error.message : String(error);

  return new ModelError('INVALID_JSON', `The model returned tool input that could not be parsed: ${message}`, true);
};

export const createAnthropicModelClient = (options: AnthropicModelOptions): ModelClient => {
  const client = new Anthropic({
    apiKey: options.apiKey,
    ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    maxRetries: 2,
  });

  return {
    model: options.model,
    effort: options.effort,
    stream: async (request, onEvent) => {
      const params: BetaMessageStreamParams = {
        model: options.model,
        max_tokens: options.maxTokens,
        system: [
          { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
          ...(request.instructions
            ? [{ type: 'text' as const, text: request.instructions, cache_control: { type: 'ephemeral' as const } }]
            : []),
        ],
        messages: toApiMessages(request.messages),
        tools: toApiTools(request.tools),
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: options.effort },
        ...(request.userId ? { metadata: { user_id: request.userId } } : {}),
        ...(options.fallbacks ? { fallbacks: 'default', betas: [FALLBACKS_BETA] } : {}),
      };
      const stream = client.beta.messages.stream(params, {
        timeout: options.timeoutMs,
        ...(request.signal ? { signal: request.signal } : {}),
      });

      try {
        for await (const event of stream) {
          const mapped = toModelEvent(event);

          if (mapped) {
            onEvent(mapped);
          }
        }

        const message = await stream.finalMessage();

        return {
          id: message.id,
          model: message.model,
          content: message.content as unknown as ContentBlock[],
          stopReason: message.stop_reason,
          stopDetails: message.stop_details ?? undefined,
          usage: usageOf(message.usage),
        };
      } catch (error) {
        if (request.signal?.aborted) {
          throw new ModelError('ABORTED', 'The request was cancelled', false);
        }

        throw toModelError(error);
      }
    },
  };
};

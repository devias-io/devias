import { randomUUID } from 'node:crypto';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { AiUsage } from '@devias/core';
import {
  APICallError,
  type FinishReason,
  type JSONSchema7,
  jsonSchema,
  type LanguageModel,
  type LanguageModelUsage,
  type ProviderMetadata,
  RetryError,
  type ModelMessage as SdkMessage,
  streamText,
  type ToolSet,
} from 'ai';
import {
  type ContentBlock,
  isTextBlock,
  isToolUseBlock,
  type ModelClient,
  ModelError,
  type ModelEvent,
  type ModelMessage,
  type ModelRequest,
  type ModelResult,
  type ToolUseBlock,
} from './types';

/**
 * Providers reached through the Vercel AI SDK. Anthropic keeps its own adapter (`anthropic.ts`) because the stored
 * messages are in its block shape and it uses features the SDK does not expose; everything else goes through here.
 */
export type AiSdkProvider = 'google' | 'openai';

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type ProviderOptions = NonNullable<SdkMessage['providerOptions']>;

export interface AiSdkModelOptions {
  provider: AiSdkProvider;
  apiKey: string;
  model: string;
  effort: Effort;
  maxTokens: number;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** A different endpoint for the provider (a proxy, Azure, or any server that speaks the same API). */
  baseURL?: string;
}

type ClientSettings = Pick<AiSdkModelOptions, 'provider' | 'model' | 'effort' | 'maxTokens' | 'timeoutMs'>;

const languageModelOf = (options: AiSdkModelOptions): LanguageModel => {
  if (options.provider === 'google') {
    return createGoogleGenerativeAI({
      apiKey: options.apiKey,
      ...(options.baseURL ? { baseURL: options.baseURL } : {}),
    })(options.model);
  }

  const openai = createOpenAI({ apiKey: options.apiKey, ...(options.baseURL ? { baseURL: options.baseURL } : {}) });

  // Other servers that speak OpenAI's API mostly know chat completions only.
  return options.baseURL ? openai.chat(options.model) : openai(options.model);
};

// ---------------------------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------------------------

/** The part of a tool call or text a provider needs back on the next request (Gemini's thought signatures). */
const metadataOf = (block: ContentBlock): ProviderMetadata | undefined =>
  (block as { providerMetadata?: ProviderMetadata }).providerMetadata;

const replayMetadata = (provider: AiSdkProvider, block: ContentBlock): ProviderOptions | undefined => {
  const metadata = metadataOf(block);

  return provider === 'google' && metadata?.google ? { google: metadata.google } : undefined;
};

export const toSdkMessages = (provider: AiSdkProvider, messages: readonly ModelMessage[]): SdkMessage[] => {
  const names = new Map<string, string>();
  const output: SdkMessage[] = [];

  for (const message of messages) {
    if (message.role === 'assistant') {
      const content: Extract<SdkMessage, { role: 'assistant' }>['content'] = [];

      for (const block of message.content) {
        const providerOptions = replayMetadata(provider, block);

        if (isTextBlock(block) && block.text.length > 0) {
          content.push({ type: 'text', text: block.text, ...(providerOptions ? { providerOptions } : {}) });
        } else if (isToolUseBlock(block)) {
          names.set(block.id, block.name);
          content.push({
            type: 'tool-call',
            toolCallId: block.id,
            toolName: block.name,
            input: block.input ?? {},
            ...(providerOptions ? { providerOptions } : {}),
          });
        }

        // Thinking blocks are shown to people but never sent back: their signatures belong to the provider that made them.
      }

      if (content.length > 0) {
        output.push({ role: 'assistant', content });
      }

      continue;
    }

    const results = message.content.flatMap((block) =>
      block.type === 'tool_result'
        ? [
            {
              type: 'tool-result' as const,
              toolCallId: block.tool_use_id,
              toolName: names.get(block.tool_use_id) ?? 'unknown',
              output: block.is_error
                ? { type: 'error-text' as const, value: block.content }
                : { type: 'text' as const, value: block.content },
            },
          ]
        : [],
    );
    const texts = message.content.flatMap((block) =>
      block.type === 'text' && block.text.length > 0 ? [{ type: 'text' as const, text: block.text }] : [],
    );

    if (results.length > 0) {
      output.push({ role: 'tool', content: results });
    }

    if (texts.length > 0) {
      output.push({ role: 'user', content: texts });
    }
  }

  return output;
};

const toSdkTools = (tools: ModelRequest['tools']): ToolSet =>
  Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      // No `execute`: the runtime runs tools itself, so the SDK stops after the model asks for them.
      { description: tool.description, inputSchema: jsonSchema(tool.inputSchema as JSONSchema7) },
    ]),
  );

/** How hard the model thinks, in the vocabulary of each provider. */
export const providerOptionsFor = (
  settings: ClientSettings,
  request: ModelRequest,
  hasBaseUrl: boolean,
): ProviderOptions => {
  if (settings.provider === 'openai') {
    return {
      openai: {
        reasoningEffort: settings.effort,
        // Business data should not be kept at the provider for later reuse.
        store: false,
        ...(hasBaseUrl ? {} : { reasoningSummary: 'auto' }),
        ...(request.userId ? { user: request.userId } : {}),
      },
    };
  }

  // Newer Gemini models take a level; the 2.x ones take a token budget.
  const level = settings.effort === 'low' || settings.effort === 'medium' ? settings.effort : 'high';
  const budgets: Record<Effort, number> = { low: 2_048, medium: 8_192, high: 16_384, xhigh: 24_576, max: 32_768 };

  return {
    google: {
      thinkingConfig: {
        includeThoughts: true,
        ...(/gemini-3/i.test(settings.model) ? { thinkingLevel: level } : { thinkingBudget: budgets[settings.effort] }),
      },
    },
  };
};

// ---------------------------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------------------------

const usageOf = (usage: LanguageModelUsage | undefined): AiUsage => {
  const cacheRead = usage?.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWrite = usage?.inputTokenDetails.cacheWriteTokens ?? 0;

  return {
    // Like Anthropic's count: what was not read from or written to the cache.
    inputTokens:
      usage?.inputTokenDetails.noCacheTokens ?? Math.max((usage?.inputTokens ?? 0) - cacheRead - cacheWrite, 0),
    outputTokens: usage?.outputTokens ?? 0,
    cacheReadInputTokens: cacheRead,
    cacheCreationInputTokens: cacheWrite,
  };
};

export const stopReasonOf = (reason: FinishReason, hasToolUse: boolean): string => {
  switch (reason) {
    case 'length':
      return 'max_tokens';
    case 'content-filter':
      return 'refusal';
    default:
      return hasToolUse ? 'tool_use' : 'end_turn';
  }
};

const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Map SDK failures to the runtime's error type. */
export const toModelError = (error: unknown): ModelError => {
  if (error instanceof ModelError) {
    return error;
  }

  if (isAbort(error)) {
    return new ModelError('ABORTED', 'The request was cancelled', false);
  }

  const cause = RetryError.isInstance(error) && error.lastError !== undefined ? error.lastError : error;

  if (isAbort(cause)) {
    return new ModelError('ABORTED', 'The request was cancelled', false);
  }

  if (APICallError.isInstance(cause)) {
    const status = cause.statusCode;

    if (status === 401 || status === 403) {
      return new ModelError('AUTH', 'The model API rejected the credentials', false, status);
    }

    if (status === 429) {
      return new ModelError('RATE_LIMITED', 'The model is rate limited; try again shortly', true, status);
    }

    if (status === 503 || status === 529 || /overloaded|unavailable/i.test(cause.message)) {
      return new ModelError('OVERLOADED', cause.message, true, status);
    }

    if (status === undefined) {
      return new ModelError('NETWORK', `Could not reach the model API: ${cause.message}`, true);
    }

    if (status >= 400 && status < 500) {
      return new ModelError('INVALID_REQUEST', cause.message, false, status);
    }

    return new ModelError('INTERNAL', cause.message, status >= 500, status);
  }

  const message = cause instanceof Error ? cause.message : String(cause);

  if (/api key|credentials/i.test(message)) {
    return new ModelError('AUTH', message, false);
  }

  return new ModelError('INTERNAL', message, false);
};

/** A model client over any AI SDK language model; exported so tests can hand it a scripted one. */
export const createAiSdkClient = (model: LanguageModel, settings: ClientSettings, hasBaseUrl = false): ModelClient => ({
  model: settings.model,
  effort: settings.effort,
  stream: async (request, onEvent) => {
    const result = streamText({
      model,
      instructions: [request.system, request.instructions].filter(Boolean).join('\n\n'),
      messages: toSdkMessages(settings.provider, request.messages),
      tools: toSdkTools(request.tools),
      maxOutputTokens: settings.maxTokens,
      maxRetries: 2,
      timeout: settings.timeoutMs,
      providerOptions: providerOptionsFor(settings, request, hasBaseUrl),
      ...(request.signal ? { abortSignal: request.signal } : {}),
      onError: () => {
        // Failures arrive as `error` parts of the stream, handled below.
      },
    });
    const content: ContentBlock[] = [];
    const open = new Map<string, number>();
    const emit = (event: ModelEvent) => onEvent(event);
    let started = false;
    let id = `msg_${randomUUID()}`;
    let modelId = settings.model;
    let finish: FinishReason = 'stop';
    let usage: LanguageModelUsage | undefined;
    // A failure is thrown once the stream has been read to its end: leaving it half read lets the SDK's own result
    // promises reject with nobody listening.
    let failure: ModelError | undefined;

    const start = () => {
      if (!started) {
        started = true;
        emit({ type: 'message_start', id, model: modelId, usage: usageOf(undefined) });
      }
    };
    const begin = (key: string, block: ContentBlock): number => {
      start();
      content.push(block);
      open.set(key, content.length - 1);
      emit({ type: 'block_start', index: content.length - 1, block });

      return content.length - 1;
    };
    const keep = (block: ContentBlock, metadata: ProviderMetadata | undefined) => {
      if (metadata && Object.keys(metadata).length > 0) {
        (block as { providerMetadata?: ProviderMetadata }).providerMetadata = { ...metadataOf(block), ...metadata };
      }
    };

    try {
      for await (const part of result.fullStream) {
        switch (part.type) {
          case 'start-step':
            start();
            break;
          case 'text-start':
            begin(`text:${part.id}`, { type: 'text', text: '' });
            break;
          case 'text-delta': {
            const index = open.get(`text:${part.id}`) ?? begin(`text:${part.id}`, { type: 'text', text: '' });
            const block = content[index];

            if (block && isTextBlock(block)) {
              block.text += part.text;
            }

            emit({ type: 'text_delta', index, text: part.text });
            break;
          }
          case 'text-end': {
            const index = open.get(`text:${part.id}`);
            const block = index === undefined ? undefined : content[index];

            if (index !== undefined && block) {
              keep(block, part.providerMetadata);
              emit({ type: 'block_stop', index });
            }

            break;
          }
          case 'reasoning-start':
            begin(`reasoning:${part.id}`, { type: 'thinking', thinking: '', signature: '' });
            break;
          case 'reasoning-delta': {
            const index =
              open.get(`reasoning:${part.id}`) ??
              begin(`reasoning:${part.id}`, { type: 'thinking', thinking: '', signature: '' });
            const block = content[index];

            if (block && block.type === 'thinking') {
              block.thinking += part.text;
            }

            emit({ type: 'thinking_delta', index, text: part.text });
            break;
          }
          case 'reasoning-end': {
            const index = open.get(`reasoning:${part.id}`);

            if (index !== undefined) {
              emit({ type: 'block_stop', index });
            }

            break;
          }
          case 'tool-input-start':
            begin(`tool:${part.id}`, { type: 'tool_use', id: part.id, name: part.toolName, input: {} });
            break;
          case 'tool-input-delta': {
            const index = open.get(`tool:${part.id}`);

            if (index !== undefined) {
              emit({ type: 'input_json_delta', index, partialJson: part.delta });
            }

            break;
          }
          case 'tool-call': {
            if (part.invalid) {
              failure ??= new ModelError(
                'INVALID_JSON',
                `The model returned tool input that could not be used: ${part.error instanceof Error ? part.error.message : 'invalid'}`,
                true,
              );
              break;
            }

            const known = open.get(`tool:${part.toolCallId}`);
            const streamed = known !== undefined;
            const index =
              known ??
              begin(`tool:${part.toolCallId}`, {
                type: 'tool_use',
                id: part.toolCallId,
                name: part.toolName,
                input: {},
              });
            const block = content[index] as ToolUseBlock;

            block.input = part.input;
            keep(block, part.providerMetadata);

            if (!streamed) {
              emit({ type: 'input_json_delta', index, partialJson: JSON.stringify(part.input ?? {}) });
            }

            emit({ type: 'block_stop', index });
            break;
          }
          case 'finish-step':
            id = part.response.id || id;
            modelId = part.response.modelId || modelId;
            usage = part.usage;
            finish = part.finishReason;
            break;
          case 'finish':
            usage = part.totalUsage;
            finish = part.finishReason;
            break;
          case 'abort':
            failure ??= new ModelError('ABORTED', 'The request was cancelled', false);
            break;
          case 'error':
            failure ??= toModelError(part.error);
            break;
          default:
            break;
        }
      }

      if (failure) {
        throw failure;
      }

      start();

      const stopReason = stopReasonOf(finish, content.some(isToolUseBlock));
      const total = usageOf(usage);

      emit({ type: 'message_delta', stopReason, usage: total });
      emit({ type: 'message_stop' });

      return { id, model: modelId, content, stopReason, usage: total } satisfies ModelResult;
    } catch (error) {
      if (request.signal?.aborted) {
        throw new ModelError('ABORTED', 'The request was cancelled', false);
      }

      throw toModelError(error);
    }
  },
});

export const createAiSdkModelClient = (options: AiSdkModelOptions): ModelClient =>
  createAiSdkClient(languageModelOf(options), options, options.baseURL !== undefined);

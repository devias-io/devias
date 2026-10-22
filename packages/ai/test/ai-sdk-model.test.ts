import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import type { ModelEvent, ModelMessage, ModelRequest } from '../src';
import { createModelClient } from '../src';
import { createAiSdkClient, providerOptionsFor, stopReasonOf, toModelError, toSdkMessages } from '../src/model/ai-sdk';

type Chunk = Record<string, unknown>;

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: { total: input, noCache: input - cacheRead - cacheWrite, cacheRead, cacheWrite },
  outputTokens: { total: output, text: output, reasoning: 0 },
});

const finish = (reason: string, tokens = usage(10, 5)) => ({
  type: 'finish',
  usage: tokens,
  finishReason: { unified: reason, raw: reason },
});

const streamOf = (chunks: Chunk[]) =>
  new ReadableStream({
    start(controller) {
      controller.enqueue({ type: 'stream-start', warnings: [] });
      controller.enqueue({ type: 'response-metadata', id: 'resp_1', modelId: 'test-model' });

      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });

const mock = (chunks: Chunk[]) =>
  new MockLanguageModelV4({
    modelId: 'test-model',
    // biome-ignore lint/suspicious/noExplicitAny: scripted stream parts
    doStream: async () => ({ stream: streamOf(chunks) as any }),
  });

const settings = (provider: 'google' | 'openai' = 'openai') => ({
  provider,
  model: provider === 'openai' ? 'gpt-5' : 'gemini-2.5-pro',
  effort: 'high' as const,
  maxTokens: 1000,
  timeoutMs: 10_000,
});

const request = (overrides: Partial<ModelRequest> = {}): ModelRequest => ({
  system: 'You are an agent.',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  tools: [
    {
      name: 'get_record',
      description: 'Read a record',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ],
  ...overrides,
});

const run = async (model: MockLanguageModelV4, provider: 'google' | 'openai', req = request()) => {
  const events: ModelEvent[] = [];
  const result = await createAiSdkClient(model, settings(provider)).stream(req, (event) => events.push(event));

  return { events, result };
};

describe('the AI SDK model client', () => {
  it('streams text and reports usage the way the Anthropic client does', async () => {
    const { events, result } = await run(
      mock([
        { type: 'text-start', id: 't1' },
        { type: 'text-delta', id: 't1', delta: 'Hello ' },
        { type: 'text-delta', id: 't1', delta: 'there' },
        { type: 'text-end', id: 't1' },
        finish('stop', usage(100, 20, 60, 10)),
      ]),
      'openai',
    );

    expect(result.content).toEqual([{ type: 'text', text: 'Hello there' }]);
    expect(result.stopReason).toBe('end_turn');
    expect(result.model).toBe('test-model');
    // Not cached: 100 - 60 read - 10 written.
    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 20,
      cacheReadInputTokens: 60,
      cacheCreationInputTokens: 10,
    });
    expect(events.map((event) => event.type)).toEqual([
      'message_start',
      'block_start',
      'text_delta',
      'text_delta',
      'block_stop',
      'message_delta',
      'message_stop',
    ]);
  });

  it('turns a whole tool call into one block, keeping Gemini’s thought signature', async () => {
    const { events, result } = await run(
      mock([
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'get_record',
          input: JSON.stringify({ id: 'r1' }),
          providerMetadata: { google: { thoughtSignature: 'sig-1' } },
        },
        finish('tool-calls'),
      ]),
      'google',
    );

    expect(result.stopReason).toBe('tool_use');
    expect(result.content).toEqual([
      {
        type: 'tool_use',
        id: 'call_1',
        name: 'get_record',
        input: { id: 'r1' },
        providerMetadata: { google: { thoughtSignature: 'sig-1' } },
      },
    ]);
    expect(events.filter((event) => event.type === 'input_json_delta')).toEqual([
      { type: 'input_json_delta', index: 0, partialJson: '{"id":"r1"}' },
    ]);
  });

  it('streams tool input as it arrives', async () => {
    const { events, result } = await run(
      mock([
        { type: 'tool-input-start', id: 'call_2', toolName: 'get_record' },
        { type: 'tool-input-delta', id: 'call_2', delta: '{"id":' },
        { type: 'tool-input-delta', id: 'call_2', delta: '"r2"}' },
        { type: 'tool-input-end', id: 'call_2' },
        { type: 'tool-call', toolCallId: 'call_2', toolName: 'get_record', input: '{"id":"r2"}' },
        finish('tool-calls'),
      ]),
      'openai',
    );

    expect(result.content).toEqual([{ type: 'tool_use', id: 'call_2', name: 'get_record', input: { id: 'r2' } }]);
    expect(events.filter((event) => event.type === 'input_json_delta').map((event) => event.partialJson)).toEqual([
      '{"id":',
      '"r2"}',
    ]);
    expect(events.filter((event) => event.type === 'block_stop')).toHaveLength(1);
  });

  it('shows reasoning as a thinking block, then the answer', async () => {
    const { result } = await run(
      mock([
        { type: 'reasoning-start', id: 'r' },
        { type: 'reasoning-delta', id: 'r', delta: 'Let me check.' },
        { type: 'reasoning-end', id: 'r' },
        { type: 'text-start', id: 't' },
        { type: 'text-delta', id: 't', delta: 'Done' },
        { type: 'text-end', id: 't' },
        finish('stop'),
      ]),
      'google',
    );

    expect(result.content).toEqual([
      { type: 'thinking', thinking: 'Let me check.', signature: '' },
      { type: 'text', text: 'Done' },
    ]);
  });

  it('maps the other finish reasons', async () => {
    expect(stopReasonOf('length', false)).toBe('max_tokens');
    expect(stopReasonOf('content-filter', false)).toBe('refusal');
    expect(stopReasonOf('stop', true)).toBe('tool_use');
    expect(stopReasonOf('other', false)).toBe('end_turn');

    const { result } = await run(mock([finish('content-filter')]), 'google');

    expect(result.stopReason).toBe('refusal');
  });

  it('sends the system prompt and tools without a way to run them, and the provider’s reasoning options', async () => {
    const model = mock([{ type: 'text-start', id: 't' }, { type: 'text-end', id: 't' }, finish('stop')]);

    await run(model, 'openai', request({ instructions: 'Be brief.', userId: 'user-1' }));

    const call = model.doStreamCalls[0];

    expect(call?.prompt[0]).toMatchObject({ role: 'system', content: 'You are an agent.\n\nBe brief.' });
    expect(call?.tools).toHaveLength(1);
    expect(call?.tools?.[0]).toMatchObject({ type: 'function', name: 'get_record' });
    expect(call?.maxOutputTokens).toBe(1000);
    expect(call?.providerOptions?.openai).toMatchObject({ reasoningEffort: 'high', store: false, user: 'user-1' });
  });

  it('fails a tool call it cannot read so the runtime asks again', async () => {
    const client = createAiSdkClient(
      mock([{ type: 'tool-call', toolCallId: 'c', toolName: 'get_record', input: '{not json' }, finish('tool-calls')]),
      settings('openai'),
    );

    await expect(client.stream(request(), () => {})).rejects.toMatchObject({ code: 'INVALID_JSON', retryable: true });
  });

  it('reports a failed call as a model error', async () => {
    const model = new MockLanguageModelV4({
      modelId: 'test-model',
      doStream: async () => {
        throw new APICallError({ message: 'Invalid key', url: 'https://x', requestBodyValues: {}, statusCode: 401 });
      },
    });
    const client = createAiSdkClient(model, settings('google'));

    await expect(client.stream(request(), () => {})).rejects.toMatchObject({ code: 'AUTH', retryable: false });
  });
});

describe('the messages sent to the provider', () => {
  const history: ModelMessage[] = [
    { role: 'user', content: [{ type: 'text', text: 'open the record' }] },
    {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'hmm', signature: 'anthropic-signature' },
        { type: 'text', text: '' },
        { type: 'text', text: 'On it.' },
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'get_record',
          input: { id: 'r1' },
          providerMetadata: { google: { thoughtSignature: 'sig-1' }, openai: { itemId: 'fc_1' } },
        },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'call_1', content: 'not found', is_error: true },
        { type: 'text', text: 'and then?' },
      ],
    },
  ];

  it('keeps the signature for Gemini, and drops the thinking and the empty text', () => {
    const messages = toSdkMessages('google', history);

    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'user']);
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'On it.' },
        {
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'get_record',
          input: { id: 'r1' },
          providerOptions: { google: { thoughtSignature: 'sig-1' } },
        },
      ],
    });
    expect(messages[2]).toEqual({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call_1',
          toolName: 'get_record',
          output: { type: 'error-text', value: 'not found' },
        },
      ],
    });
  });

  it('sends nothing provider-specific to OpenAI', () => {
    const assistant = toSdkMessages('openai', history)[1];

    expect(JSON.stringify(assistant)).not.toContain('providerOptions');
  });
});

describe('reasoning options', () => {
  it('uses a level for Gemini 3 and a token budget for older models', () => {
    const older = providerOptionsFor({ ...settings('google'), effort: 'low' }, request(), false);
    const newer = providerOptionsFor(
      { ...settings('google'), model: 'gemini-3-pro', effort: 'xhigh' },
      request(),
      false,
    );

    expect(older.google).toEqual({ thinkingConfig: { includeThoughts: true, thinkingBudget: 2048 } });
    expect(newer.google).toEqual({ thinkingConfig: { includeThoughts: true, thinkingLevel: 'high' } });
  });

  it('asks OpenAI for a summary only on its own endpoint', () => {
    expect(providerOptionsFor(settings('openai'), request(), false).openai).toMatchObject({ reasoningSummary: 'auto' });
    expect(providerOptionsFor(settings('openai'), request(), true).openai).not.toHaveProperty('reasoningSummary');
  });
});

describe('model errors', () => {
  const failure = (statusCode?: number, message = 'failed') =>
    new APICallError({ message, url: 'https://x', requestBodyValues: {}, ...(statusCode ? { statusCode } : {}) });

  it('maps statuses to the runtime’s codes', () => {
    expect(toModelError(failure(401))).toMatchObject({ code: 'AUTH', retryable: false });
    expect(toModelError(failure(429))).toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(toModelError(failure(503))).toMatchObject({ code: 'OVERLOADED', retryable: true });
    expect(toModelError(failure(400))).toMatchObject({ code: 'INVALID_REQUEST', retryable: false });
    expect(toModelError(failure(500))).toMatchObject({ code: 'INTERNAL', retryable: true });
    expect(toModelError(failure())).toMatchObject({ code: 'NETWORK', retryable: true });
  });

  it('recognises a cancelled request', () => {
    const abort = new Error('aborted');

    abort.name = 'AbortError';

    expect(toModelError(abort)).toMatchObject({ code: 'ABORTED' });
  });
});

describe('the configured provider', () => {
  const base = { apiKey: 'test-key', effort: 'high' as const, maxTokens: 1000, fallbacks: false, timeoutMs: 10_000 };

  it('builds a client for each provider without reaching the network', () => {
    for (const [provider, model] of [
      ['anthropic', 'claude-opus-5'],
      ['google', 'gemini-2.5-pro'],
      ['openai', 'gpt-5'],
    ] as const) {
      const client = createModelClient({ ...base, provider, model });

      expect(client).toMatchObject({ model, effort: 'high' });
      expect(typeof client.stream).toBe('function');
    }

    expect(
      createModelClient({ ...base, provider: 'openai', model: 'local', baseURL: 'http://localhost:11434/v1' }),
    ).toMatchObject({
      model: 'local',
    });
  });
});

import type { ChatEvent } from '@devias/core';
import { describe, expect, it, vi } from 'vitest';
import { createHttpClient, DeviasApiError, streamRequest } from '../src';

const sse = (frames: string[], init?: RequestInit) => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  init?.signal?.addEventListener('abort', () => {
    try {
      controller.error(new DOMException('aborted', 'AbortError'));
    } catch {
      // closed
    }
  });
  const response = new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });

  return {
    response,
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    frames,
  };
};

describe('streamRequest', () => {
  it('posts the body with stream headers and delivers parsed events, ignoring comments and junk', async () => {
    let handle: ReturnType<typeof sse> | undefined;
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      handle = sse([], init);

      return handle.response;
    });
    const http = createHttpClient({ baseUrl: 'http://api.test', apiKey: 'k', fetch });
    const events: ChatEvent[] = [];
    const stream = streamRequest({
      http,
      path: '/api/workspaces/ws/ai/conversations/c1/messages',
      body: { content: 'hi' },
      onEvent: (e) => events.push(e),
    });
    await vi.waitFor(() => expect(handle).toBeDefined());
    expect(calls[0]?.url).toBe('http://api.test/api/workspaces/ws/ai/conversations/c1/messages');
    expect(calls[0]?.init?.method).toBe('POST');
    const headers = (calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers.accept).toBe('text/event-stream');
    expect(headers['x-api-key']).toBe('k');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ content: 'hi' });

    handle?.push(': ping\n\n');
    handle?.push(
      'event: turn_start\ndata: {"type":"turn_start","turnId":"t1","conversationId":"c1","iteration":0}\n\n',
    );
    const split = 'event: text_delta\ndata: {"type":"text_delta","messageId":"m1","blockIndex":0,"text":"hi"}\n\n';
    handle?.push(split.slice(0, 15));
    handle?.push(split.slice(15));
    handle?.push('data: not json\n\n');
    handle?.push(
      'event: done\ndata: {"type":"done","turnId":"t1","status":"completed","usage":{"inputTokens":1,"outputTokens":1,"cacheReadInputTokens":0,"cacheCreationInputTokens":0}}\n\n',
    );
    handle?.close();
    await stream.done;
    expect(events.map((e) => e.type)).toEqual(['turn_start', 'text_delta', 'done']);
  });

  it('maps error responses to DeviasApiError and resolves quietly when aborted', async () => {
    const http = createHttpClient({
      baseUrl: 'http://api.test',
      fetch: async () =>
        new Response(JSON.stringify({ error: { code: 'CONFLICT', message: 'busy' } }), {
          status: 409,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const failing = streamRequest({ http, path: '/x', body: {}, onEvent: () => {} });
    await expect(failing.done).rejects.toMatchObject({ status: 409, code: 'CONFLICT', message: 'busy' });
    expect(await failing.done.catch((e) => e)).toBeInstanceOf(DeviasApiError);

    let handle: ReturnType<typeof sse> | undefined;
    const http2 = createHttpClient({
      baseUrl: 'http://api.test',
      fetch: async (_url, init) => {
        handle = sse([], init);

        return handle.response;
      },
    });
    const events: ChatEvent[] = [];
    const aborted = streamRequest({ http: http2, path: '/x', body: {}, onEvent: (e) => events.push(e) });
    await vi.waitFor(() => expect(handle).toBeDefined());
    handle?.push(
      'event: turn_start\ndata: {"type":"turn_start","turnId":"t1","conversationId":"c1","iteration":0}\n\n',
    );
    await vi.waitFor(() => expect(events).toHaveLength(1));
    aborted.abort();
    await expect(aborted.done).resolves.toBeUndefined();
  });
});

import type { EventStreamStatus, WorkspaceEvent } from '@devias/core';
import { describe, expect, it, vi } from 'vitest';
import { subscribeEvents } from '../src';

interface FakeStream {
  response: Response;
  push: (text: string) => void;
  close: () => void;
  signal: AbortSignal | undefined;
}

/** A controllable SSE response whose stream errors when the request signal aborts (like a real fetch). */
const sseStream = (init?: RequestInit): FakeStream => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  const signal = init?.signal ?? undefined;
  signal?.addEventListener('abort', () => {
    try {
      controller.error(new DOMException('aborted', 'AbortError'));
    } catch {
      // already closed
    }
  });

  return {
    response: new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (text) => controller.enqueue(encoder.encode(text)),
    close: () => controller.close(),
    signal,
  };
};

const until = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const start = Date.now();

  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out waiting for condition');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

const headersOf = (call: { init?: RequestInit | undefined } | undefined): Record<string, string> =>
  (call?.init?.headers ?? {}) as Record<string, string>;

const event = (sequence: number, type: WorkspaceEvent['type'] = 'record.created'): string =>
  JSON.stringify({
    sequence,
    type,
    workspaceId: 'ws',
    actor: { kind: 'user', id: 'u1' },
    occurredAt: '2026-09-21T00:00:00.000Z',
    objectId: 'o1',
    object: 'person',
    recordId: `r${sequence}`,
  });

describe('subscribeEvents', () => {
  it('parses ready and events, ignores heartbeats, tracks ids and resumes with Last-Event-ID', async () => {
    const streams: FakeStream[] = [];
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const stream = sseStream(init);
      streams.push(stream);

      return stream.response;
    });
    const received: WorkspaceEvent[] = [];
    const statuses: EventStreamStatus[] = [];
    const unsubscribe = subscribeEvents({
      url: 'http://localhost:3000/api/workspaces/ws/events',
      headers: { 'x-api-key': 'k' },
      fetch,
      minRetryDelayMs: 0,
      onEvent: (e) => received.push(e),
      onStatus: (s) => statuses.push(s),
    });
    await until(() => streams.length === 1);
    expect(calls[0]?.url).toBe('http://localhost:3000/api/workspaces/ws/events');
    expect(headersOf(calls[0])['x-api-key']).toBe('k');
    expect(headersOf(calls[0]).accept).toBe('text/event-stream');
    expect(headersOf(calls[0])['last-event-id']).toBeUndefined();

    const first = streams[0] as FakeStream;
    first.push('event: ready\ndata: {"sequence":5}\n\n');
    first.push(': ping\n\n');
    first.push(`id: 6\nevent: record.created\ndata: ${event(6)}\n\n`);
    // A message split across chunks must still parse.
    const second = `id: 7\nevent: record.updated\ndata: ${event(7, 'record.updated')}\n\n`;
    first.push(second.slice(0, 20));
    first.push(second.slice(20));
    await until(() => received.length === 2);
    expect(received.map((e) => [e.sequence, e.type])).toEqual([
      [6, 'record.created'],
      [7, 'record.updated'],
    ]);
    expect(statuses).toEqual(['connecting', 'open']);

    // Server closes the stream: reconnect after the sequence we last saw.
    first.close();
    await until(() => streams.length === 2);
    expect(calls[1]?.url).toBe('http://localhost:3000/api/workspaces/ws/events?after=7');
    expect(headersOf(calls[1])['last-event-id']).toBe('7');
    await until(() => statuses.length === 4);
    expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);

    // Replayed duplicates are dropped, new events flow.
    const replay = streams[1] as FakeStream;
    replay.push('event: ready\ndata: {"sequence":7}\n\n');
    replay.push(`id: 7\nevent: record.updated\ndata: ${event(7, 'record.updated')}\n\n`);
    replay.push(`id: 8\nevent: record.deleted\ndata: ${event(8, 'record.deleted')}\n\n`);
    await until(() => received.length === 3);
    expect(received[2]?.sequence).toBe(8);

    unsubscribe();
    expect(statuses.at(-1)).toBe('closed');
    expect(replay.signal?.aborted).toBe(true);
    await tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(statuses.filter((s) => s === 'closed')).toHaveLength(1);
  });

  it('sends the initial `after` as both query parameter and header', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });

      return sseStream(init).response;
    });
    const unsubscribe = subscribeEvents({ url: '/api/workspaces/ws/events?x=1', after: 41, fetch, onEvent: () => {} });
    await until(() => calls.length === 1);
    expect(calls[0]?.url).toBe('/api/workspaces/ws/events?x=1&after=41');
    expect(headersOf(calls[0])['last-event-id']).toBe('41');
    unsubscribe();
  });

  it('reconnects when the heartbeat times out', async () => {
    const streams: FakeStream[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const stream = sseStream(init);
      streams.push(stream);

      return stream.response;
    });
    const statuses: EventStreamStatus[] = [];
    const unsubscribe = subscribeEvents({
      url: '/events',
      fetch,
      heartbeatTimeoutMs: 30,
      minRetryDelayMs: 0,
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
    });
    await until(() => streams.length >= 2);
    expect(streams[0]?.signal?.aborted).toBe(true);
    expect(statuses).toContain('reconnecting');
    unsubscribe();
  });

  it('backs off exponentially after failed connections and stops after unsubscribe', async () => {
    vi.useFakeTimers();

    try {
      const fetch = vi.fn(async () => {
        throw new TypeError('fetch failed');
      });
      const statuses: EventStreamStatus[] = [];
      const unsubscribe = subscribeEvents({
        url: '/events',
        fetch,
        onEvent: () => {},
        onStatus: (s) => statuses.push(s),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(statuses).toEqual(['connecting', 'reconnecting']);
      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(fetch).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(fetch).toHaveBeenCalledTimes(4);
      unsubscribe();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(statuses.at(-1)).toBe('closed');
    } finally {
      vi.useRealTimers();
    }
  });

  it('reconnects with backoff when the server answers with an error status', async () => {
    let calls = 0;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      calls += 1;

      if (calls === 1) {
        return new Response('nope', { status: 503 });
      }

      return sseStream(init).response;
    });
    const statuses: EventStreamStatus[] = [];
    const unsubscribe = subscribeEvents({
      url: '/events',
      fetch,
      minRetryDelayMs: 0,
      onEvent: () => {},
      onStatus: (s) => statuses.push(s),
    });
    await until(() => statuses.includes('open'));
    expect(statuses).toEqual(['connecting', 'reconnecting', 'open']);
    unsubscribe();
  });
});

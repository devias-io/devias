import type { EventStreamStatus, WorkspaceEvent } from '@devias/core';
import { createParser, type EventSourceMessage } from 'eventsource-parser';
import type { FetchLike } from './http';

/**
 * Subscribe to a workspace's SSE change feed with `fetch` (so custom headers such as `x-api-key` work,
 * unlike the browser `EventSource`). Handles resume (`?after=` + `Last-Event-ID`), exponential backoff,
 * heartbeat timeouts and reconnecting when a background tab becomes visible again.
 *
 * Wire format: `id: <sequence>`, `event: <type>`, `data: <WorkspaceEvent JSON>`; the first message is
 * `event: ready` with `{ "sequence": n }`; heartbeats are comment lines (`: ping`).
 */
export interface SubscribeEventsOptions {
  url: string;
  headers?: Record<string, string>;
  /** Resume after this sequence (exclusive). */
  after?: number;
  onEvent: (event: WorkspaceEvent) => void;
  onStatus?: (status: EventStreamStatus) => void;
  fetch?: FetchLike;
  credentials?: RequestCredentials;
  /** Reconnect when nothing (not even a heartbeat) arrived for this long. Default 45 s. */
  heartbeatTimeoutMs?: number;
  /** Exponential backoff bounds between reconnect attempts. Defaults 1 s → 30 s. */
  minRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 45_000;
export const DEFAULT_MIN_RETRY_DELAY_MS = 1_000;
export const DEFAULT_MAX_RETRY_DELAY_MS = 30_000;
const MAX_BACKOFF_EXPONENT = 10;

type Timer = ReturnType<typeof setTimeout>;

const withAfter = (url: string, after: number | undefined): string =>
  after === undefined ? url : `${url}${url.includes('?') ? '&' : '?'}after=${encodeURIComponent(String(after))}`;

const parseSequence = (value: string | undefined): number | undefined => {
  if (value === undefined || value === '') {
    return undefined;
  }

  const sequence = Number(value);

  return Number.isFinite(sequence) ? sequence : undefined;
};

export const subscribeEvents = (options: SubscribeEventsOptions): (() => void) => {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  const minRetryDelayMs = options.minRetryDelayMs ?? DEFAULT_MIN_RETRY_DELAY_MS;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;

  let lastSequence = options.after;
  let closed = false;
  let attempt = 0;
  let status: EventStreamStatus | null = null;
  let controller: AbortController | null = null;
  let heartbeatTimer: Timer | undefined;
  let reconnectTimer: Timer | undefined;
  let serverRetryMs: number | undefined;
  let lastActivity = Date.now();

  const setStatus = (next: EventStreamStatus) => {
    if (status === next) {
      return;
    }

    status = next;
    options.onStatus?.(next);
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer === undefined) {
      return;
    }

    clearTimeout(heartbeatTimer);
    heartbeatTimer = undefined;
  };

  /** Any traffic (events or `: ping` comments) proves the connection is alive. */
  const touch = () => {
    lastActivity = Date.now();
    clearHeartbeat();
    const active = controller;
    heartbeatTimer = setTimeout(() => {
      if (active && controller === active) {
        active.abort();
      }
    }, heartbeatTimeoutMs);
  };

  const deliver = (message: EventSourceMessage) => {
    if (message.event === 'ready') {
      attempt = 0;

      try {
        const payload = JSON.parse(message.data) as { sequence?: unknown };

        if (typeof payload.sequence === 'number' && lastSequence === undefined) {
          lastSequence = payload.sequence;
        }
      } catch {
        // malformed ready payload: nothing to resume from
      }

      return;
    }

    if (!message.data) {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(message.data);
    } catch {
      return;
    }

    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') {
      return;
    }

    const event = parsed as WorkspaceEvent;
    const sequence = parseSequence(message.id) ?? (typeof event.sequence === 'number' ? event.sequence : undefined);

    if (sequence !== undefined) {
      // A replay after reconnecting may overlap with what we already delivered.
      if (lastSequence !== undefined && sequence <= lastSequence) {
        return;
      }

      lastSequence = sequence;
    }

    attempt = 0;

    try {
      options.onEvent(event);
    } catch (error) {
      console.error('[devias-sdk] event handler threw', error);
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== undefined) {
      return;
    }

    setStatus('reconnecting');
    const base = serverRetryMs ?? minRetryDelayMs;
    const delay = Math.min(maxRetryDelayMs, base * 2 ** Math.min(attempt, MAX_BACKOFF_EXPONENT));
    attempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, delay);
  };

  const connect = async (): Promise<void> => {
    if (closed) {
      return;
    }

    const active = new AbortController();
    controller = active;
    const headers: Record<string, string> = { accept: 'text/event-stream', ...options.headers };

    if (lastSequence !== undefined) {
      headers['last-event-id'] = String(lastSequence);
    }

    let response: Response;

    try {
      response = await fetchImpl(withAfter(options.url, lastSequence), {
        headers,
        signal: active.signal,
        credentials: options.credentials ?? 'include',
      });
    } catch {
      if (closed || controller !== active) {
        return;
      }

      scheduleReconnect();

      return;
    }

    if (closed || controller !== active) {
      return;
    }

    if (!response.ok || !response.body) {
      scheduleReconnect();

      return;
    }

    setStatus('open');
    const parser = createParser({
      onEvent: deliver,
      onComment: touch,
      onRetry: (retryMs) => {
        serverRetryMs = retryMs;
      },
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    touch();

    try {
      for (;;) {
        const { value, done } = await reader.read();

        if (done) {
          break;
        }

        touch();
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch {
      // aborted (heartbeat timeout or unsubscribe) or the connection dropped
    }

    clearHeartbeat();

    if (closed || controller !== active) {
      return;
    }

    scheduleReconnect();
  };

  /** Tab visible again or network back: reconnect now instead of waiting out the backoff. */
  const wake = () => {
    if (closed) {
      return;
    }

    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }

    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      attempt = 0;
      void connect();

      return;
    }

    if (status === 'open' && Date.now() - lastActivity > heartbeatTimeoutMs) {
      controller?.abort();
    }
  };

  const doc = typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : null;
  const win = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
  doc?.addEventListener('visibilitychange', wake);
  win?.addEventListener('online', wake);

  setStatus('connecting');
  void connect();

  return () => {
    if (closed) {
      return;
    }

    closed = true;

    if (reconnectTimer !== undefined) {
      clearTimeout(reconnectTimer);
    }

    reconnectTimer = undefined;
    clearHeartbeat();
    doc?.removeEventListener('visibilitychange', wake);
    win?.removeEventListener('online', wake);
    const active = controller;
    controller = null;
    active?.abort();
    setStatus('closed');
  };
};

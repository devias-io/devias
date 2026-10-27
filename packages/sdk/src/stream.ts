import { type AiStreamHandle, type ChatEvent, DeviasApiError } from '@devias/core';
import { createParser } from 'eventsource-parser';
import { errorFromResponse, type HttpClient } from './http';

/**
 * POST a JSON body and consume the `text/event-stream` reply frame by frame. Unlike the change feed
 * this never reconnects: a turn's stream is one request, and the server keeps the turn running if the
 * listener goes away (the caller reloads the thread afterwards).
 */
export interface StreamRequestOptions {
  http: HttpClient;
  path: string;
  body: unknown;
  onEvent: (event: ChatEvent) => void;
  signal?: AbortSignal | undefined;
}

const isAbortError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError';

export const streamRequest = ({ http, path, body, onEvent, signal }: StreamRequestOptions): AiStreamHandle => {
  const controller = new AbortController();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  const done = (async () => {
    let response: Response;

    try {
      response = await http.fetch(http.url(path), {
        method: 'POST',
        credentials: http.credentials,
        headers: {
          accept: 'text/event-stream',
          'content-type': 'application/json',
          ...http.headers(),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        return;
      }

      throw new DeviasApiError(0, 'NETWORK', `Network error calling POST ${path}: ${(error as Error).message}`, error);
    }

    if (!response.ok) {
      throw await errorFromResponse(response);
    }

    if (!response.body) {
      throw new DeviasApiError(response.status, 'INTERNAL', 'The server returned no stream body');
    }

    const parser = createParser({
      onEvent: (message) => {
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

        try {
          onEvent(parsed as ChatEvent);
        } catch (error) {
          console.error('[devias-sdk] chat event handler threw', error);
        }
      },
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      for (;;) {
        const { value, done: finished } = await reader.read();

        if (finished) {
          break;
        }

        parser.feed(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        return;
      }

      throw new DeviasApiError(0, 'NETWORK', `The stream for POST ${path} was interrupted`, error);
    } finally {
      reader.releaseLock();
    }
  })();

  return { abort: () => controller.abort(), done };
};

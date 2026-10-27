import type { ChatEvent } from '@devias/core';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import crm from '@devias/mod-crm/server';
import emailResend from '@devias/mod-email-resend/server';
import paymentStripe from '@devias/mod-payment-stripe/server';
import type { ModuleFetch } from '@devias/server';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { choresManifest } from './chores';

export const createTestServer = async (
  options: {
    moduleFetch?: ModuleFetch /** Start workspaces as a product does: core modules only. */;
    bare?: boolean;
  } = {},
): Promise<Server> => {
  const config = loadConfig({
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
    MIGRATE_ON_BOOT: 'true',
    LOG_LEVEL: 'error',
  });

  return createServer(config, {
    modules: [crm, paymentStripe, emailResend],
    // Most tests want the CRM's objects (and some chores) to work with; a new workspace does not start with them.
    builtin: options.bare ? [] : [crmManifest, choresManifest],
    ...(options.moduleFetch ? { moduleFetch: options.moduleFetch } : {}),
    pgliteDataDir: 'memory://',
  });
};

export interface Session {
  cookie: string;
  userId: string;
  email: string;
}

const cookieOf = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0] ?? '')
    .filter(Boolean)
    .join('; ');

export const signUp = async (server: Server, email: string, name = 'Test User'): Promise<Session> => {
  const response = await server.app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email, password: 'password123' }),
  });

  if (response.status !== 200) {
    throw new Error(`sign-up failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as { user: { id: string } };

  return { cookie: cookieOf(response), userId: body.user.id, email };
};

export const signIn = async (server: Server, email: string, password = 'password123'): Promise<string> => {
  const response = await server.app.request('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (response.status !== 200) {
    throw new Error(`sign-in failed: ${response.status} ${await response.text()}`);
  }

  return cookieOf(response);
};

export type Api = (
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
) => Promise<{ status: number; json: unknown; headers: Headers }>;

/** Fetch helper bound to a cookie or api key; parses JSON when present. */
export const client =
  (server: Server, auth: { cookie?: string; apiKey?: string } = {}): Api =>
  async (path, init = {}) => {
    const headers: Record<string, string> = { ...(init.headers ?? {}) };

    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    if (auth.cookie) {
      headers.cookie = auth.cookie;
    }

    if (auth.apiKey) {
      headers['x-api-key'] = auth.apiKey;
    }

    const response = await server.app.request(path, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    let json: unknown = null;

    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    return { status: response.status, json, headers: response.headers };
  };

export const createWorkspace = async (
  api: Api,
  name = 'Acme',
  slug = 'acme',
): Promise<{ id: string; slug: string }> => {
  const response = await api('/api/workspaces', { body: { name, slug } });

  if (response.status !== 201) {
    throw new Error(`workspace creation failed: ${response.status} ${JSON.stringify(response.json)}`);
  }

  return response.json as { id: string; slug: string };
};

/** Read SSE frames from a streamed response until `count` events (excluding comments) arrived. */
export const readSse = async (
  response: Response,
  count: number,
  timeoutMs = 10_000,
): Promise<{ event?: string; id?: string; data: string }[]> => {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error('no body');
  }

  const decoder = new TextDecoder();
  const frames: { event?: string; id?: string; data: string }[] = [];
  let buffer = '';
  const deadline = Date.now() + timeoutMs;

  while (frames.length < count && Date.now() < deadline) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((resolve) =>
        setTimeout(() => resolve({ value: undefined, done: true }), deadline - Date.now()),
      ),
    ]);

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');

    while (index !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const frame: { event?: string; id?: string; data: string } = { data: '' };
      let isComment = true;

      for (const line of raw.split('\n')) {
        if (line.startsWith(':')) {
          continue;
        }

        isComment = false;

        if (line.startsWith('event:')) {
          frame.event = line.slice(6).trim();
        } else if (line.startsWith('id:')) {
          frame.id = line.slice(3).trim();
        } else if (line.startsWith('data:')) {
          frame.data += line.slice(5).trim();
        }
      }

      if (!isComment) {
        frames.push(frame);
      }

      index = buffer.indexOf('\n\n');
    }
  }

  reader.releaseLock();

  return frames;
};

/** Read every SSE frame until the server closes the stream. */
export const readChatEvents = async (response: Response): Promise<ChatEvent[]> => {
  const reader = response.body?.getReader();

  if (!reader) {
    throw new Error('no body');
  }

  const decoder = new TextDecoder();
  const events: ChatEvent[] = [];
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');

    while (index !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = raw
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');

      if (data) {
        events.push(JSON.parse(data) as ChatEvent);
      }

      index = buffer.indexOf('\n\n');
    }
  }

  return events;
};

import { createFakeModelClient, text, toolUse } from '@devias/ai/testing';
import type { ChatEvent } from '@devias/core';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import crm from '@devias/mod-crm/server';
import { ids as emailIds } from '@devias/mod-email-resend/manifest';
import emailResend from '@devias/mod-email-resend/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, readChatEvents, type Session, signUp } from './helpers';

const KEY = 're_live_only_the_person_knows_7f3a';

/** Answers like Resend would for a good key, and records what was sent. */
const resendFetch = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? '';

  if (auth !== `Bearer ${KEY}`) {
    return json({ message: 'API key is invalid' }, 401);
  }

  if (url.startsWith('https://api.resend.com/domains')) {
    return json({ data: [{ name: 'acme.test', status: 'verified' }] });
  }

  if (url.startsWith('https://api.resend.com/emails')) {
    return json({ id: 'em_test_1' });
  }

  return json({ message: 'unexpected' }, 500);
});

/**
 * Phase 0's acceptance scenario: "Install Resend, set it up and send me a test email." The agent does all of it
 * through actions, the person approves each step and types the key into a card, and the key never reaches the
 * model, the conversation or the logs of the turn.
 */
describe('an agent sets up an integration end to end', () => {
  let server: Server;
  let alice: Session;
  let api: Api;
  let ws: { id: string; slug: string };
  let base: string;
  const model = createFakeModelClient([], { delayMs: 0 });

  beforeAll(async () => {
    server = await createServer(
      loadConfig({
        BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
        MIGRATE_ON_BOOT: 'true',
        LOG_LEVEL: 'error',
      }),
      {
        modules: [crm, emailResend],
        builtin: [crmManifest],
        pgliteDataDir: 'memory://',
        modelClient: model,
        moduleFetch: resendFetch as never,
      },
    );
    alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    ws = await createWorkspace(api, 'Acme', 'acme');
    base = `/api/workspaces/${ws.id}/ai`;
  });
  afterAll(() => server.close());

  const pendingOf = (events: ChatEvent[]) => {
    const pause = events.find((event) => event.type === 'paused');

    return pause?.type === 'paused' ? pause.pending[0] : undefined;
  };
  const resultOf = (events: ChatEvent[]) => {
    const result = events.find((event) => event.type === 'tool_result');

    return result?.type === 'tool_result' ? result : undefined;
  };
  const resolve = async (conversationId: string, toolCallId: string, body: unknown) =>
    readChatEvents(
      await server.app.request(`${base}/conversations/${conversationId}/tool-calls/${toolCallId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify(body),
      }),
    );

  it('installs Resend, takes the key through a secure card, and sends a test email', async () => {
    model.push(
      { content: [toolUse('install_module', { module: emailIds.module }, 'tu_install')] },
      { content: [toolUse('connect_module', { module: emailIds.module }, 'tu_settings')] },
      {
        content: [
          toolUse(
            'send_email',
            { from: 'Alice <alice@acme.test>', to: 'alice@example.com', subject: 'Test', text: 'It works.' },
            'tu_send',
          ),
        ],
      },
      { content: [text('Resend is set up and the test email is on its way.')] },
    );
    const conversation = (await api(`${base}/conversations`, { body: {} })).json as { id: string };
    const started = await readChatEvents(
      await server.app.request(`${base}/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ content: 'Install Resend, set it up and send me a test email.' }),
      }),
    );

    // 1. Installing waits for approval.
    const install = pendingOf(started);
    expect(install).toMatchObject({ name: 'install_module', requiresApproval: true });
    const installed = await resolve(conversation.id, install?.id ?? '', { approved: true });
    expect(resultOf(installed)).toMatchObject({
      status: 'executed',
      result: { installed: true, module: emailIds.module },
    });

    // 2. Connecting asks the person for the key; nothing is filled in by the model.
    const settings = pendingOf(installed);
    expect(settings).toMatchObject({ name: 'connect_module', input: { module: emailIds.module } });
    expect(settings?.inputRequest?.fields).toEqual([
      expect.objectContaining({ name: 'api_key', secret: true, required: true }),
      expect.objectContaining({ name: 'webhook_secret', required: false }),
    ]);
    const missing = await server.app.request(
      `${base}/conversations/${conversation.id}/tool-calls/${settings?.id}/resolve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ approved: true, values: {} }),
      },
    );
    expect(missing.status).toBe(400);
    const configured = await resolve(conversation.id, settings?.id ?? '', { approved: true, values: { api_key: KEY } });
    expect(resultOf(configured)).toMatchObject({
      status: 'executed',
      result: { module: emailIds.module, belongsTo: 'workspace', status: 'connected', saved: ['api_key'] },
    });

    // 3. Sending runs Resend's action after approval, with the key the person typed.
    const send = pendingOf(configured);
    expect(send).toMatchObject({ name: 'send_email', requiresApproval: true });
    const sent = await resolve(conversation.id, send?.id ?? '', { approved: true });
    // What Resend answered is outside content: the model gets it labelled as data.
    expect(resultOf(sent)).toMatchObject({
      status: 'executed',
      result: { untrusted: expect.any(String), content: { id: 'em_test_1' } },
    });
    expect(sent.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    const email = resendFetch.mock.calls.find(([url]) => url === 'https://api.resend.com/emails');
    const headers = (email?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);

    // The key reached Resend and nothing else: not the model, not the conversation, not the stored calls.
    const thread = (await api(`${base}/conversations/${conversation.id}`)).json;
    const calls = await server.ai.store.toolCalls.list(conversation.id);
    expect(JSON.stringify([model.requests, thread, calls])).not.toContain(KEY);
    const list = (await api(`/api/workspaces/${ws.id}/connections?module=${emailIds.module}`)).json as {
      connections: { status: string }[];
    };
    expect(list.connections.map((connection) => connection.status)).toEqual(['connected']);
  });
});

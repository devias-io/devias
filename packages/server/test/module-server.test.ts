import { defineModule } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type ActionContext,
  defineActionHandler,
  defineModuleServer,
  inputMismatch,
  type ModuleContext,
  RetryableError,
} from '../src';

const manifest = defineModule({
  id: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
  version: '0.1.0',
  label: 'Mailer',
  connections: [
    { id: '01a1751f-5f0a-70f6-b258-7fe4ff716b07', kind: 'api_key', fields: [{ name: 'api_key', label: 'API key' }] },
  ],
  actions: [
    {
      id: '01a1751f-5f0d-769d-975f-3dec4f4d5066',
      name: 'send',
      label: 'Send',
      input: [{ name: 'to', label: 'To', required: true }],
    },
  ],
  events: [{ id: '01a1751f-5f0d-769d-975f-43976493500f', name: 'delivered' }],
});

const seen: ModuleContext[] = [];
const send = defineActionHandler({
  id: '01a1751f-5f0d-769d-975f-3dec4f4d5066',
  input: z.object({ to: z.string() }),
  run: (input, ctx) => {
    seen.push(ctx);

    return { sentTo: input.to };
  },
});
const webhook = { parse: () => [{ type: 'delivered', payload: {} }] };
const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('inputMismatch', () => {
  const declared = [
    { name: 'to', label: 'To', type: 'text' as const, required: true },
    { name: 'note', label: 'Note', type: 'text' as const, required: false },
  ];

  it('is satisfied by a handler that takes the declared keys, required ones required', () => {
    expect(inputMismatch(declared, z.object({ to: z.string(), note: z.string().optional() }))).toBeNull();
    // Only an object schema can be compared.
    expect(inputMismatch(declared, z.unknown())).toBeNull();
  });

  it('says what differs: a key the manifest lacks, a key the handler lacks, or a required one that may be missing', () => {
    expect(inputMismatch(declared, z.object({ to: z.string(), note: z.string(), cc: z.string() }))).toContain('"cc"');
    expect(inputMismatch(declared, z.object({ to: z.string() }))).toContain('"note"');
    expect(inputMismatch(declared, z.object({ to: z.string().optional(), note: z.string() }))).toContain(
      '"to" is declared required',
    );
  });

  it('is checked when the module loads', () => {
    const loose = defineActionHandler({
      id: '01a1751f-5f0d-769d-975f-3dec4f4d5066',
      input: z.object({ to: z.string().optional() }),
      run: () => null,
    });
    expect(() => defineModuleServer(manifest, { actions: [loose], webhook })).toThrow('accepts it missing');
  });
});

describe('defineModuleServer', () => {
  it('needs a handler for exactly the declared actions', () => {
    expect(() => defineModuleServer(manifest, { webhook })).toThrow('declares the action "send" but has no handler');
    const other = defineActionHandler({
      id: '01a1751f-5f14-73f0-9bec-ba1f0bb796bd',
      input: z.object({}),
      run: () => null,
    });
    expect(() => defineModuleServer(manifest, { actions: [send, other], webhook })).toThrow(
      'implements the action "01a1751f-5f14-73f0-9bec-ba1f0bb796bd", which its manifest does not declare',
    );
    expect(() => defineModuleServer(manifest, { actions: [send, send], webhook })).toThrow(
      '"01a1751f-5f0d-769d-975f-3dec4f4d5066" twice',
    );
  });

  it('pairs a webhook with declared events', () => {
    expect(() => defineModuleServer(manifest, { actions: [send] })).toThrow('declares events but has no webhook');
    const quiet = defineModule({ id: '01a1751f-5f15-7708-9f78-43d5001e99c2', version: '0.1.0' });
    expect(() => defineModuleServer(quiet, { webhook })).toThrow('has a webhook but its manifest declares no events');
  });

  it('pairs connection code with declared connections', () => {
    expect(() =>
      defineModuleServer(manifest, {
        actions: [send],
        webhook,
        connections: [{ id: '01a1751f-5f0c-7611-94cf-04aad0105afe', test: async () => ({ ok: true }) }],
      }),
    ).toThrow(
      'has code for the connection "01a1751f-5f0c-7611-94cf-04aad0105afe", which its manifest does not declare',
    );
    const test = async () => ({ ok: true });
    expect(() =>
      defineModuleServer(manifest, {
        actions: [send],
        webhook,
        connections: [
          { id: '01a1751f-5f0a-70f6-b258-7fe4ff716b07', test },
          { id: '01a1751f-5f0a-70f6-b258-7fe4ff716b07', test },
        ],
      }),
    ).toThrow('has code for the connection "01a1751f-5f0a-70f6-b258-7fe4ff716b07" twice');
  });

  it('names a failure worth trying again, and how long to wait', () => {
    expect(new RetryableError('Rate limited', 60_000)).toMatchObject({ name: 'RetryableError', retryAfterMs: 60_000 });
    expect(new RetryableError('Busy')).toMatchObject({ name: 'RetryableError', retryAfterMs: undefined });
  });

  it('keeps the handlers, the connection code and the webhook for the runtime', async () => {
    const test = async () => ({ ok: true });
    const handler = { id: '01a1751f-5f0a-70f6-b258-7fe4ff716b07', test };
    const module = defineModuleServer(manifest, { actions: [send], connections: [handler], webhook });
    expect(module.actions).toEqual([send]);
    expect(module.connections).toEqual([handler]);
    expect(module.webhook).toBe(webhook);
    const connection = {
      id: 'c_1',
      providerId: '01a1751f-5f0a-70f6-b258-7fe4ff716b07',
      kind: 'api_key' as const,
      visibility: 'workspace' as const,
      account: null,
      values: { api_key: 'k' },
      accessToken: '',
    };
    const ctx = {
      workspaceId: 'ws_1',
      variables: {},
      connection: async () => connection,
      reportAuthFailure: () => {},
      kv: { get: async () => undefined, set: async () => {}, delete: async () => {} },
      fetch: async () => new Response(),
      logger: noopLogger,
      actor: { kind: 'function' as const, id: '01a1751f-5f0d-769d-975f-3dec4f4d5066' },
      engine: {} as ActionContext['engine'],
      notify: async () => ({ recipients: 0, created: 0, updated: 0 }),
    };
    expect(await module.actions[0]?.run({ to: 'a@x.test' }, ctx)).toEqual({ sentTo: 'a@x.test' });
    expect(seen[0]?.workspaceId).toBe('ws_1');
    expect((await seen[0]?.connection())?.values).toEqual({ api_key: 'k' });
  });
});

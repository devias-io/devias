import { defineModule } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type ActionContext,
  defineActionHandler,
  defineJobHandler,
  defineModuleServer,
  inputMismatch,
  type ModuleContext,
  RetryableError,
} from '../src';

const manifest = defineModule({
  id: 'mailer',
  version: '0.1.0',
  name: 'Mailer',
  connections: [{ id: 'mailer.default', kind: 'api_key', fields: [{ name: 'api_key', label: 'API key' }] }],
  actions: [{ id: 'mailer.send', label: 'Send', input: [{ name: 'to', label: 'To', required: true }] }],
  events: [{ id: 'mailer.delivered' }],
});

const seen: ModuleContext[] = [];
const send = defineActionHandler({
  id: 'mailer.send',
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
      id: 'mailer.send',
      input: z.object({ to: z.string().optional() }),
      run: () => null,
    });
    expect(() => defineModuleServer(manifest, { actions: [loose], webhook })).toThrow('accepts it missing');
  });
});

describe('defineModuleServer', () => {
  it('needs a handler for exactly the declared actions', () => {
    expect(() => defineModuleServer(manifest, { webhook })).toThrow('declares the action "send" but has no handler');
    const other = defineActionHandler({ id: 'mailer.other', input: z.object({}), run: () => null });
    expect(() => defineModuleServer(manifest, { actions: [send, other], webhook })).toThrow(
      'implements the action "mailer.other", which its manifest does not declare',
    );
    expect(() => defineModuleServer(manifest, { actions: [send, send], webhook })).toThrow('"mailer.send" twice');
  });

  it('pairs a webhook with declared events', () => {
    expect(() => defineModuleServer(manifest, { actions: [send] })).toThrow('declares events but has no webhook');
    const quiet = defineModule({ id: 'quiet', version: '0.1.0' });
    expect(() => defineModuleServer(quiet, { webhook })).toThrow('has a webhook but its manifest declares no events');
  });

  it('pairs connection code with declared connections', () => {
    expect(() =>
      defineModuleServer(manifest, {
        actions: [send],
        webhook,
        connections: { google: { test: async () => ({ ok: true }) } },
      }),
    ).toThrow('has code for the connection "google", which its manifest does not declare');
  });

  it('checks jobs and their schedules', () => {
    const sync = defineJobHandler({ run: () => null });
    const base = { actions: [send], webhook };
    expect(() => defineModuleServer(manifest, { ...base, jobs: { 'not ok': sync } })).toThrow(
      'job names are identifiers',
    );
    expect(() =>
      defineModuleServer(manifest, {
        ...base,
        jobs: { sync },
        schedules: [{ name: 'nightly', cron: '0 3 * * *', job: 'other' }],
      }),
    ).toThrow('runs the job "other", which it does not define');
    expect(() =>
      defineModuleServer(manifest, {
        ...base,
        jobs: { sync },
        schedules: [{ name: 'nightly', cron: '0 25 * * *', job: 'sync' }],
      }),
    ).toThrow('Cron hour "25" is not valid');
    const schedules = [
      { name: 'nightly', cron: '0 3 * * *', job: 'sync' },
      { name: 'nightly', cron: '0 4 * * *', job: 'sync' },
    ];
    expect(() => defineModuleServer(manifest, { ...base, jobs: { sync }, schedules })).toThrow(
      'repeated schedule name',
    );
    const module = defineModuleServer(manifest, { ...base, jobs: { sync }, schedules: [schedules[0] as never] });
    expect(module.jobs.sync).toBe(sync);
    expect(module.schedules).toEqual([{ name: 'nightly', cron: '0 3 * * *', job: 'sync' }]);
    expect(new RetryableError('Rate limited', 60_000)).toMatchObject({ name: 'RetryableError', retryAfterMs: 60_000 });
  });

  it('keeps the handlers, the connection code and the webhook for the runtime', async () => {
    const test = async () => ({ ok: true });
    const module = defineModuleServer(manifest, { actions: [send], connections: { default: { test } }, webhook });
    expect(module.actions).toEqual([send]);
    expect(module.connections.default?.test).toBe(test);
    expect(module.webhook).toBe(webhook);
    const connection = {
      id: 'c_1',
      providerId: 'default',
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
      jobs: { enqueue: async () => ({ id: 'job_1', status: 'pending' }) },
      fetch: async () => new Response(),
      logger: noopLogger,
      actor: { kind: 'function' as const, id: 'mailer.send' },
      engine: {} as ActionContext['engine'],
      notify: async () => ({ recipients: 0, created: 0, updated: 0 }),
    };
    expect(await module.actions[0]?.run({ to: 'a@x.test' }, ctx)).toEqual({ sentTo: 'a@x.test' });
    expect(seen[0]?.workspaceId).toBe('ws_1');
    expect((await seen[0]?.connection())?.values).toEqual({ api_key: 'k' });
  });
});

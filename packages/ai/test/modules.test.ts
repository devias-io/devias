import { defineModule, type InputRequest, type ModuleManifest, moduleActionSpec, parseManifest } from '@devias/core';
import { type EngineContext, scopeEngine, silentLogger } from '@devias/data-engine';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { builtinTools } from '../src/tools/builtin';
import type { ActionsPort, ToolDefinition, ToolRunContext } from '../src/tools/types';
import { createHarness, enginePort, type Harness, platformTools } from './helpers';

const mailer = defineModule({
  id: 'mailer',
  version: '0.1.0',
  name: 'Mailer',
  publisher: { id: 'mail-co', name: 'Mail Co', url: 'https://mail.test' },
  connections: [{ id: 'mailer.default', kind: 'api_key', fields: [{ name: 'api_key', label: 'API key' }] }],
  actions: [
    {
      id: 'mailer.send',
      label: 'Send an email',
      input: [
        { name: 'to', label: 'To', type: 'email', required: true },
        { name: 'subject', label: 'Subject', required: true },
      ],
      output: [{ name: 'id', description: 'The email id.' }],
    },
  ],
  events: [{ id: 'mailer.delivered' }, { id: 'mailer.bounced' }],
  policies: [
    {
      id: 'mailer.sending',
      description: 'Sending always needs review.',
      match: { actionId: 'mailer.send' },
      decision: 'review',
    },
  ],
});
const calendar = defineModule({
  id: 'calendar-sync',
  version: '0.1.0',
  name: 'Calendar sync',
  variables: [
    { key: 'CLIENT_ID', label: 'Client id', server: true },
    { key: 'CLIENT_SECRET', label: 'Client secret', server: true, secret: true },
  ],
  connections: [
    {
      id: 'calendar-sync.account',
      kind: 'oauth2',
      label: 'Calendar account',
      oauth: {
        authorizeUrl: 'https://accounts.example/authorize',
        tokenUrl: 'https://accounts.example/token',
        clientId: { variable: 'CLIENT_ID' },
        clientSecret: { variable: 'CLIENT_SECRET' },
      },
    },
  ],
});
const sendSpec = moduleActionSpec(
  mailer,
  mailer.actions[0] as never,
  z.object({ to: z.string(), subject: z.string() }),
);
const memo = defineModule({
  id: 'memo',
  version: '0.1.0',
  name: 'Memo',
  description: 'Memos for the team.',
  publisher: { id: 'memo-co', name: 'Memo Co' },
  objects: [
    {
      id: 'memo.memo',
      nameSingular: 'memo',
      namePlural: 'memos',
      labelSingular: 'Memo',
      labelPlural: 'Memos',
      fields: [{ id: 'memo.memo.title', name: 'title', label: 'Title', type: 'text' }],
    },
  ],
});
/** What the server's catalog offers right now. */
let catalog: ModuleManifest[] = [];
/** Whether the server has the calendar's OAuth client; the server decides that from its environment. */
let calendarAvailable = false;
/** The host's actions, as far as these tools reach them: the engine behind the connection actions. */
const invoke = vi.fn(async (ctx: EngineContext, id: string, input: unknown): Promise<unknown> => {
  switch (id) {
    case 'core.list_connections':
      return {
        providers: [
          {
            moduleId: 'calendar-sync',
            providerId: 'account',
            kind: 'oauth2',
            label: 'Calendar account',
            visibility: 'user',
            available: calendarAvailable,
            ...(calendarAvailable
              ? {}
              : { problem: 'Not configured on this server: set DEVIAS_MOD_CALENDAR_SYNC_CLIENT_ID' }),
          },
        ],
        connections: await h.engine.connections.list(ctx, input as { module?: string }),
      };
    case 'core.connect_module':
      return h.engine.connections.create(ctx, input);
    case 'core.update_connection':
      return h.engine.connections.update(ctx, (input as { id: string }).id, input);
    case 'core.list_module_catalog':
      return catalog;
    case 'core.plan_module':
      return h.engine.modules.plan(ctx, (input as { manifest: typeof memo }).manifest);
    case 'core.apply_module': {
      const { manifest, ...options } = input as { manifest: typeof memo; expectedPlanHash: string };

      return h.engine.modules.apply(ctx, manifest, options);
    }
    default:
      return { id: 'em_1' };
  }
});
const port: ActionsPort = { specs: [sendSpec], invoke };

let h: Harness;

beforeAll(async () => {
  h = await createHarness([], { actions: port });
  await h.engine.modules.apply(h.owner, mailer);
  await h.engine.modules.apply(h.owner, calendar);
  await h.engine.connections.create(h.owner, { module: 'mailer', values: { api_key: 'key_1234567890abcdef' } });
});
afterAll(() => h.close());

const contextFor = (ctx: EngineContext): ToolRunContext => ({
  workspaceId: h.workspaceId,
  ctx,
  engine: h.engine,
  scoped: scopeEngine(h.engine, ctx),
  logger: silentLogger,
  navigate: () => {},
  actions: port,
});

const runTool = async (tool: ToolDefinition, input: unknown, ctx: EngineContext) =>
  // biome-ignore lint/suspicious/noExplicitAny: a tool's result is untyped JSON that the tests read freely
  tool.run(tool.input.parse(input), contextFor(ctx)) as Promise<any>;

// biome-ignore lint/suspicious/noExplicitAny: a tool's result is untyped JSON that the tests read freely
const run = async (name: string, input: unknown, ctx: EngineContext = h.owner): Promise<any> => {
  const handWritten = builtinTools.find((t) => t.name === name);

  if (handWritten) {
    return runTool(handWritten, input, ctx);
  }

  // One made from an action: it runs the engine's own handlers, as the server's do.
  const generated = platformTools(h.engine).find((t) => t.name === name);

  if (!generated) {
    throw new Error(`no tool ${name}`);
  }

  return generated.run(generated.input.parse(input), { ...contextFor(ctx), actions: enginePort(h.engine) });
};

describe('module tools', () => {
  it('lists installed modules, with status, actions, fields and events for those with a service', async () => {
    const listed = await run('list_modules', {}, h.member);
    expect(listed.modules.map((e: { id: string }) => e.id).sort()).toEqual(['calendar-sync', 'fixture', 'mailer']);
    const fixture = listed.modules.find((e: { id: string }) => e.id === 'fixture');
    expect(fixture).toMatchObject({ version: expect.any(String) });
    expect(fixture).not.toHaveProperty('status');
    const mailer = listed.modules.find((e: { id: string }) => e.id === 'mailer');
    expect(mailer).toMatchObject({
      id: 'mailer',
      name: 'Mailer',
      status: 'connected',
      connections: [{ provider: 'default', belongsTo: 'workspace', status: 'connected' }],
      events: ['delivered', 'bounced'],
      // Who publishes it and what needs review, so the agent can explain it.
      publisher: 'Mail Co',
      policies: [{ description: 'Sending always needs review.', decision: 'review' }],
    });
    expect(listed.modules.find((e: { id: string }) => e.id === 'calendar-sync')).toMatchObject({
      status: 'not connected',
      connections: [],
    });
    expect(mailer.actions[0]).toMatchObject({
      id: 'send',
      input: [
        { name: 'to', type: 'email', required: true },
        { name: 'subject', type: 'text', required: true },
      ],
      output: [{ name: 'id', type: 'text', description: 'The email id.' }],
    });
    expect(JSON.stringify(listed)).not.toContain('key_1234567890abcdef');
  });

  it('offers a module action as a tool only where the module is installed', async () => {
    expect(h.service.registry.get('mailer__send')?.moduleId).toBe('mailer');
    expect((await h.service.status(h.owner)).tools.map((tool) => tool.name)).toContain('mailer__send');
    const bare = await createHarness([], { actions: port, seed: false });

    try {
      expect((await bare.service.status(bare.owner)).tools.map((tool) => tool.name)).not.toContain('mailer__send');
    } finally {
      await bare.close();
    }
  });

  it('describes the action from its declaration and runs it as the action it is', async () => {
    const tool = h.service.registry.get('mailer__send');

    if (!tool) {
      throw new Error('mailer declares an action');
    }

    expect(tool).toMatchObject({ approval: 'approve', externalContent: true });
    expect(tool.description).toContain('Mailer: Send an email');
    expect(tool.description).toContain('to (required): To');
    expect(tool.available?.(h.member, h.engine)).toBe(true);
    const input = { to: 'a@x.test', subject: 'Hi' };
    expect(await runTool(tool, input, h.member)).toEqual({ id: 'em_1' });
    expect(invoke).toHaveBeenCalledWith(h.member, 'mailer.send', input);
  });

  it('connects with an API key typed into a secure form, replacing the key of a module already connected', async () => {
    const tool = builtinTools.find((t) => t.name === 'connect_module');

    if (!tool?.requestInput) {
      throw new Error('connect_module asks for input');
    }

    expect(tool.available?.(h.member, h.engine)).toBe(true);
    const request = await tool.requestInput({ module: 'Mailer' }, contextFor(h.owner));
    expect(request).toMatchObject({ title: 'Connect Mailer', fields: [{ name: 'api_key', required: true }] });
    expect(request).not.toHaveProperty('connect');
    // Mailer is connected already: the typed key replaces the old one.
    const result = await tool.run(tool.input.parse({ module: 'mailer' }), {
      ...contextFor(h.owner),
      secrets: { api_key: 'key_replaced_0000000000' },
    });
    expect(result).toMatchObject({ module: 'mailer', belongsTo: 'workspace', status: 'connected', saved: ['api_key'] });
    expect(JSON.stringify(result)).not.toContain('key_replaced_0000000000');
    const [connection] = await h.engine.connections.list(h.owner, { module: 'mailer' });
    expect((await h.engine.connections.open(h.workspaceId, connection?.id ?? '')).credentials.api_key).toBe(
      'key_replaced_0000000000',
    );
    expect(await run('connect_module', { module: 'mailer' })).toMatchObject({ changed: false });
  });

  it("opens the provider's consent page for an account, and says who was connected", async () => {
    const tool = builtinTools.find((t) => t.name === 'connect_module');

    if (!tool?.requestInput) {
      throw new Error('connect_module asks for input');
    }

    // The server cannot reach the provider yet: the agent hears why before anyone tries.
    await expect(tool.requestInput({ module: 'calendar-sync' }, contextFor(h.member))).rejects.toThrow(
      'Not configured on this server',
    );
    calendarAvailable = true;
    expect(await tool.requestInput({ module: 'calendar-sync' }, contextFor(h.member))).toEqual({
      title: 'Connect your Calendar account',
      fields: [],
      connect: { module: 'calendar-sync', provider: 'account', visibility: 'user', label: 'Calendar account' },
    });
    // Approved without connecting: nothing to report but that.
    expect(await run('connect_module', { module: 'calendar-sync' }, h.member)).toMatchObject({ connected: false });
    await h.engine.connections.saveOAuth({
      workspaceId: h.workspaceId,
      moduleId: 'calendar-sync',
      providerId: 'account',
      visibility: 'user',
      userId: 'u_member',
      account: 'member@example.com',
      tokens: { accessToken: 'at', expiresAt: null },
    });
    expect(await run('connect_module', { module: 'calendar-sync' }, h.member)).toMatchObject({
      connected: true,
      account: 'member@example.com',
      belongsTo: 'you',
    });
  });

  it('says on the consent card how many agents installing adds, and names them in the catalog', async () => {
    const tool = builtinTools.find((t) => t.name === 'install_module');

    if (!tool?.requestInput) {
      throw new Error('install_module asks for consent');
    }

    catalog = [
      parseManifest({
        ...memo,
        agents: [
          { id: 'memo.scribe', name: 'Scribe', actionIds: ['core.list_records'] },
          { id: 'memo.editor', name: 'Editor', actionIds: ['core.list_records'] },
        ],
      }),
    ];
    const request = await tool.requestInput({ module: 'memo' }, contextFor(h.owner));
    expect(request?.consent?.changes).toEqual(['Adds 1 object, 1 field', 'Adds 2 agents']);
    const listed = (await run('list_module_catalog', {})) as { modules: { brings: { agents: string[] } }[] };
    expect(listed.modules[0]?.brings.agents).toEqual(['Scribe', 'Editor']);
    catalog = [];
  });

  it('installs from a consent card, and only the version the person agreed to', async () => {
    const tool = builtinTools.find((t) => t.name === 'install_module');

    if (!tool?.requestInput) {
      throw new Error('install_module asks for consent');
    }

    await expect(tool.requestInput({ module: 'memo' }, contextFor(h.owner))).rejects.toThrow('No module "memo"');

    catalog = [memo];
    const request = (await tool.requestInput({ module: 'Memo' }, contextFor(h.owner))) as InputRequest;
    expect(request).toMatchObject({
      title: 'Install Memo',
      description: 'Memos for the team.',
      fields: [],
      consent: {
        module: 'memo',
        name: 'Memo',
        version: '0.1.0',
        fromVersion: null,
        publisher: 'Memo Co',
        policies: [],
        changes: ['Adds 1 object, 1 field'],
      },
    });
    const install = () => tool.run(tool.input.parse({ module: 'memo' }), { ...contextFor(h.owner), request });

    // The module changed on the server after the card was shown: what the person agreed to is not what would apply.
    catalog = [parseManifest({ ...memo, version: '0.2.0', description: 'Changed since.' })];
    await expect(install()).rejects.toThrow(/changed on the server since the person was asked/);
    expect((await h.engine.metadata.getSnapshot(h.workspaceId)).schema.modules.map((m) => m.moduleId)).not.toContain(
      'memo',
    );

    catalog = [memo];
    expect(await install()).toMatchObject({ installed: true, module: 'memo', from: null, version: '0.1.0' });
    // Installed as offered: nothing left to agree to.
    await expect(tool.requestInput({ module: 'memo' }, contextFor(h.owner))).rejects.toThrow(
      'Memo 0.1.0 is installed: nothing to do',
    );
  });

  it('treats only outside services as outside content', () => {
    const local = defineModule({
      id: 'scoring',
      version: '0.1.0',
      actions: [{ id: 'scoring.rescore', label: 'Rescore leads', external: false, approval: 'auto' }],
    });
    const spec = moduleActionSpec(local, local.actions[0] as never, z.object({}));
    expect(spec).toMatchObject({
      id: 'scoring.rescore',
      module: 'scoring',
      externalContent: false,
      approval: 'auto',
      permission: 'module.run',
      ai: { tool: 'scoring__rescore' },
      http: { method: 'post', path: '/api/workspaces/{workspaceId}/modules/scoring/actions/rescore' },
    });
  });

  it('builds workflows with event triggers and action steps, resolving modules by name', async () => {
    const created = await run('create_workflow', {
      title: 'On delivery',
      trigger: { kind: 'event', moduleId: 'Mailer', types: ['delivered'] },
      steps: [
        {
          kind: 'action',
          actionId: 'core.create_record',
          input: { object: 'Chores', values: { title: 'Delivered {{event.payload.id}}' } },
        },
        { kind: 'action', actionId: 'mailer.send', input: { to: 'ops@x.test', subject: 'Delivered' } },
      ],
    });
    expect(created).toMatchObject({ created: true, trigger: { kind: 'event', moduleId: 'mailer' } });
    expect(created.steps[1]).toMatchObject({ kind: 'action', actionId: 'mailer.send' });
    await expect(
      run('create_workflow', {
        title: 'Broken',
        trigger: { kind: 'event', moduleId: 'nope', types: ['*'] },
        steps: [{ kind: 'action', actionId: 'core.create_record', input: { object: 'chore', values: {} } }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

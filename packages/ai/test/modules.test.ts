import {
  coreIds,
  defineModule,
  type InputRequest,
  type ModuleManifest,
  moduleActionSpec,
  parseManifest,
} from '@devias/core';
import { type EngineContext, scopeEngine, silentLogger } from '@devias/data-engine';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { builtinTools } from '../src/tools/builtin';
import type { ActionsPort, ToolDefinition, ToolRunContext } from '../src/tools/types';
import { createHarness, enginePort, type Harness, platformTools } from './helpers';

const mailer = defineModule({
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
      label: 'Send an email',
      input: [
        { name: 'to', label: 'To', type: 'email', required: true },
        { name: 'subject', label: 'Subject', required: true },
      ],
      output: [{ name: 'id', description: 'The email id.' }],
    },
  ],
  events: [
    { id: '01a1751f-5f0d-769d-975f-43976493500f', name: 'delivered' },
    { id: '01a1751f-5f16-75e0-8a26-4a4d749e3460', name: 'bounced' },
  ],
  policies: [
    {
      id: '01a1751f-5f16-75e0-8a26-4cda8a27d508',
      description: 'Sending always needs review.',
      match: { actionId: '01a1751f-5f0d-769d-975f-3dec4f4d5066' },
      decision: 'review',
    },
  ],
});
const calendar = defineModule({
  id: '01a1751f-5f0d-769d-975f-5ecf07b21598',
  version: '0.1.0',
  label: 'Calendar sync',
  variables: [
    { id: '01a1751f-5f0d-769d-975f-474b0fc44405', label: 'Client id', required: true },
    { id: '01a1751f-5f0d-769d-975f-4a1e55d4ecf7', label: 'Client secret', secret: true, required: true },
  ],
  connections: [
    {
      id: '01a1751f-5f0d-769d-975f-4f7a9e1772d5',
      kind: 'oauth2',
      label: 'Calendar account',
      oauth: {
        authorizeUrl: 'https://accounts.example/authorize',
        tokenUrl: 'https://accounts.example/token',
        clientId: { variable: '01a1751f-5f0d-769d-975f-474b0fc44405' },
        clientSecret: { variable: '01a1751f-5f0d-769d-975f-4a1e55d4ecf7' },
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
  id: '01a1751f-5f16-75e0-8a26-685afd565857',
  version: '0.1.0',
  label: 'Memo',
  description: 'Memos for the team.',
  objects: [
    {
      id: '01a1751f-5f16-75e0-8a26-515e63b93cb4',
      nameSingular: 'memo',
      namePlural: 'memos',
      labelSingular: 'Memo',
      labelPlural: 'Memos',
      fields: [{ id: '01a1751f-5f16-75e0-8a26-5611335952eb', name: 'title', label: 'Title', type: 'text' }],
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
    case coreIds.actions.list_connections:
      return {
        providers: [
          {
            moduleId: '01a1751f-5f0d-769d-975f-5ecf07b21598',
            providerId: '01a1751f-5f0d-769d-975f-4f7a9e1772d5',
            kind: 'oauth2',
            label: 'Calendar account',
            visibility: 'user',
            available: calendarAvailable,
            ...(calendarAvailable ? {} : { problem: 'Needs Client id and Client secret in Variables' }),
          },
        ],
        connections: await h.engine.connections.list(ctx, input as { module?: string }),
      };
    case coreIds.actions.connect_module:
      return h.engine.connections.create(ctx, input);
    case coreIds.actions.update_connection:
      return h.engine.connections.update(ctx, (input as { id: string }).id, input);
    case coreIds.actions.list_module_catalog:
      return catalog;
    case coreIds.actions.plan_module:
      return h.engine.modules.plan(ctx, (input as { manifest: typeof memo }).manifest);
    case coreIds.actions.apply_module: {
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
  await h.engine.connections.create(h.owner, {
    module: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
    values: { api_key: 'key_1234567890abcdef' },
  });
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
    expect(listed.modules.map((e: { id: string }) => e.id).sort()).toEqual(
      [
        '01a1751f-5f0d-769d-975f-5ecf07b21598',
        '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
        '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      ].sort(),
    );
    const fixture = listed.modules.find((e: { id: string }) => e.id === '01a1751f-5f09-7114-9d75-ce42abd8a6ef');
    expect(fixture).toMatchObject({ version: expect.any(String) });
    expect(fixture).not.toHaveProperty('status');
    const mailer = listed.modules.find((e: { id: string }) => e.id === '01a1751f-5f0a-70f6-b258-c2c96a69790f');
    expect(mailer).toMatchObject({
      id: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      name: 'Mailer',
      status: 'connected',
      connections: [{ provider: '01a1751f-5f0a-70f6-b258-7fe4ff716b07', belongsTo: 'workspace', status: 'connected' }],
      events: ['delivered', 'bounced'],
      // What needs review, so the agent can explain it.
      policies: [{ description: 'Sending always needs review.', decision: 'review' }],
    });
    expect(listed.modules.find((e: { id: string }) => e.id === '01a1751f-5f0d-769d-975f-5ecf07b21598')).toMatchObject({
      status: 'not connected',
      connections: [],
    });
    expect(mailer.actions[0]).toMatchObject({
      name: 'send',
      input: [
        { name: 'to', type: 'email', required: true },
        { name: 'subject', type: 'text', required: true },
      ],
      output: [{ name: 'id', type: 'text', description: 'The email id.' }],
    });
    expect(JSON.stringify(listed)).not.toContain('key_1234567890abcdef');
  });

  it('offers a module action as a tool only where the module is installed', async () => {
    expect(h.service.registry.get('send')?.moduleId).toBe('01a1751f-5f0a-70f6-b258-c2c96a69790f');
    expect((await h.service.status(h.owner)).tools.map((tool) => tool.name)).toContain('send');
    const bare = await createHarness([], { actions: port, seed: false });

    try {
      expect((await bare.service.status(bare.owner)).tools.map((tool) => tool.name)).not.toContain('send');
    } finally {
      await bare.close();
    }
  });

  it('describes the action from its declaration and runs it as the action it is', async () => {
    const tool = h.service.registry.get('send');

    if (!tool) {
      throw new Error('mailer declares an action');
    }

    expect(tool).toMatchObject({ approval: 'approve', externalContent: true });
    expect(tool.description).toContain('Mailer: Send an email');
    expect(tool.description).toContain('to (required): To');
    expect(tool.available?.(h.member, h.engine)).toBe(true);
    const input = { to: 'a@x.test', subject: 'Hi' };
    expect(await runTool(tool, input, h.member)).toEqual({ id: 'em_1' });
    expect(invoke).toHaveBeenCalledWith(h.member, '01a1751f-5f0d-769d-975f-3dec4f4d5066', input);
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
    const result = await tool.run(tool.input.parse({ module: '01a1751f-5f0a-70f6-b258-c2c96a69790f' }), {
      ...contextFor(h.owner),
      secrets: { api_key: 'key_replaced_0000000000' },
    });
    expect(result).toMatchObject({
      module: '01a1751f-5f0a-70f6-b258-c2c96a69790f',
      belongsTo: 'workspace',
      status: 'connected',
      saved: ['api_key'],
    });
    expect(JSON.stringify(result)).not.toContain('key_replaced_0000000000');
    const [connection] = await h.engine.connections.list(h.owner, { module: '01a1751f-5f0a-70f6-b258-c2c96a69790f' });
    expect((await h.engine.connections.open(h.workspaceId, connection?.id ?? '')).credentials.api_key).toBe(
      'key_replaced_0000000000',
    );
    expect(await run('connect_module', { module: '01a1751f-5f0a-70f6-b258-c2c96a69790f' })).toMatchObject({
      changed: false,
    });
  });

  it("opens the provider's consent page for an account, and says who was connected", async () => {
    const tool = builtinTools.find((t) => t.name === 'connect_module');

    if (!tool?.requestInput) {
      throw new Error('connect_module asks for input');
    }

    // The workspace has not set up the provider's app yet: the agent hears why before anyone tries.
    await expect(
      tool.requestInput({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }, contextFor(h.member)),
    ).rejects.toThrow('Needs Client id and Client secret in Variables');
    calendarAvailable = true;
    expect(await tool.requestInput({ module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }, contextFor(h.member))).toEqual({
      title: 'Connect your Calendar account',
      fields: [],
      connect: {
        module: '01a1751f-5f0d-769d-975f-5ecf07b21598',
        provider: '01a1751f-5f0d-769d-975f-4f7a9e1772d5',
        visibility: 'user',
        label: 'Calendar account',
      },
    });
    // Approved without connecting: nothing to report but that.
    expect(await run('connect_module', { module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }, h.member)).toMatchObject({
      connected: false,
    });
    await h.engine.connections.saveOAuth({
      workspaceId: h.workspaceId,
      moduleId: '01a1751f-5f0d-769d-975f-5ecf07b21598',
      providerId: '01a1751f-5f0d-769d-975f-4f7a9e1772d5',
      visibility: 'user',
      userId: 'u_member',
      account: 'member@example.com',
      tokens: { accessToken: 'at', expiresAt: null },
    });
    expect(await run('connect_module', { module: '01a1751f-5f0d-769d-975f-5ecf07b21598' }, h.member)).toMatchObject({
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
          { id: '01a1751f-5f16-75e0-8a26-58ed1199326b', label: 'Scribe', actionIds: [coreIds.actions.list_records] },
          { id: '01a1751f-5f16-75e0-8a26-5eed14f90f4a', label: 'Editor', actionIds: [coreIds.actions.list_records] },
        ],
      }),
    ];
    const request = await tool.requestInput({ module: '01a1751f-5f16-75e0-8a26-685afd565857' }, contextFor(h.owner));
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

    await expect(
      tool.requestInput({ module: '01a1751f-5f16-75e0-8a26-685afd565857' }, contextFor(h.owner)),
    ).rejects.toThrow('No module "01a1751f-5f16-75e0-8a26-685afd565857"');

    catalog = [memo];
    const request = (await tool.requestInput({ module: 'Memo' }, contextFor(h.owner))) as InputRequest;
    expect(request).toMatchObject({
      title: 'Install Memo',
      description: 'Memos for the team.',
      fields: [],
      consent: {
        module: '01a1751f-5f16-75e0-8a26-685afd565857',
        label: 'Memo',
        version: '0.1.0',
        fromVersion: null,
        policies: [],
        changes: ['Adds 1 object, 1 field'],
      },
    });
    const install = () =>
      tool.run(tool.input.parse({ module: '01a1751f-5f16-75e0-8a26-685afd565857' }), {
        ...contextFor(h.owner),
        request,
      });

    // The module changed on the server after the card was shown: what the person agreed to is not what would apply.
    catalog = [parseManifest({ ...memo, version: '0.2.0', description: 'Changed since.' })];
    await expect(install()).rejects.toThrow(/changed on the server since the person was asked/);
    expect((await h.engine.metadata.getSnapshot(h.workspaceId)).schema.modules.map((m) => m.id)).not.toContain(
      '01a1751f-5f16-75e0-8a26-685afd565857',
    );

    catalog = [memo];
    expect(await install()).toMatchObject({
      installed: true,
      module: '01a1751f-5f16-75e0-8a26-685afd565857',
      from: null,
      version: '0.1.0',
    });
    // Installed as offered: nothing left to agree to.
    await expect(
      tool.requestInput({ module: '01a1751f-5f16-75e0-8a26-685afd565857' }, contextFor(h.owner)),
    ).rejects.toThrow('Memo 0.1.0 is installed: nothing to do');
  });

  it('treats only outside services as outside content', () => {
    const local = defineModule({
      id: '01a1751f-5f0f-73b8-8e84-4223da96e386',
      version: '0.1.0',
      actions: [
        {
          id: '01a1751f-5f16-75e0-8a26-63dc611b5852',
          name: 'rescore',
          label: 'Rescore leads',
          external: false,
          approval: 'auto',
        },
      ],
    });
    const spec = moduleActionSpec(local, local.actions[0] as never, z.object({}));
    expect(spec).toMatchObject({
      id: '01a1751f-5f16-75e0-8a26-63dc611b5852',
      module: '01a1751f-5f0f-73b8-8e84-4223da96e386',
      externalContent: false,
      approval: 'auto',
      permission: 'module.run',
      ai: { tool: 'rescore' },
      http: {
        method: 'post',
        path: '/api/workspaces/{workspaceId}/modules/01a1751f-5f0f-73b8-8e84-4223da96e386/actions/rescore',
      },
    });
  });

  it('calls an action by its name, which need not be the end of its id', () => {
    const local = defineModule({
      id: '01a1751f-5f0f-73b8-8e84-4223da96e386',
      version: '0.1.0',
      actions: [{ id: '01a1751f-5f16-75e0-8a26-63dc611b5852', name: 'rescore_leads', label: 'Rescore leads' }],
    });
    expect(moduleActionSpec(local, local.actions[0] as never, z.object({}))).toMatchObject({
      id: '01a1751f-5f16-75e0-8a26-63dc611b5852',
      ai: { tool: 'rescore_leads' },
      http: {
        path: '/api/workspaces/{workspaceId}/modules/01a1751f-5f0f-73b8-8e84-4223da96e386/actions/rescore_leads',
      },
    });
  });

  it('builds workflows with event triggers and action steps, resolving modules by name', async () => {
    const created = await run('create_workflow', {
      title: 'On delivery',
      trigger: { kind: 'module_event', moduleId: 'Mailer', types: ['delivered'] },
      steps: [
        {
          kind: 'action',
          actionId: coreIds.actions.create_record,
          input: { object: 'Chores', values: { title: 'Delivered {{event.payload.id}}' } },
        },
        {
          kind: 'action',
          actionId: '01a1751f-5f0d-769d-975f-3dec4f4d5066',
          input: { to: 'ops@x.test', subject: 'Delivered' },
        },
      ],
    });
    expect(created).toMatchObject({
      created: true,
      trigger: { kind: 'module_event', moduleId: '01a1751f-5f0a-70f6-b258-c2c96a69790f' },
    });
    expect(created.steps[1]).toMatchObject({ kind: 'action', actionId: '01a1751f-5f0d-769d-975f-3dec4f4d5066' });
    await expect(
      run('create_workflow', {
        title: 'Broken',
        trigger: { kind: 'module_event', moduleId: 'nope', types: ['*'] },
        steps: [{ kind: 'action', actionId: coreIds.actions.create_record, input: { object: 'chore', values: {} } }],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('takes an action in a workflow step by its name or by its id, and stores the id', async () => {
    await h.engine.modules.apply(
      h.owner,
      defineModule({
        id: '01a1751f-5f17-70dd-a237-828d7789176f',
        version: '0.1.0',
        label: 'Stock room',
        actions: [
          {
            id: '01a1751f-5f16-75e0-8a26-642241ce35ce',
            name: 'count_stock',
            label: 'Count stock',
            external: false,
            approval: 'auto',
          },
        ],
      }),
    );
    const stepOf = async (actionId: string) =>
      (
        await run('create_workflow', {
          title: `Step ${actionId}`,
          trigger: { kind: 'manual', objectId: 'chore' },
          steps: [{ kind: 'action', actionId, input: {} }],
        })
      ).steps[0];

    // The name the tool is called by, and the id as it stands.
    for (const written of ['count_stock', '01a1751f-5f16-75e0-8a26-642241ce35ce']) {
      expect(await stepOf(written), written).toMatchObject({
        kind: 'action',
        actionId: '01a1751f-5f16-75e0-8a26-642241ce35ce',
      });
    }

    // A core action is still called by its tool's name.
    const core = await run('create_workflow', {
      title: 'A core step',
      trigger: { kind: 'manual', objectId: 'chore' },
      steps: [{ kind: 'action', actionId: 'create_record', input: { object: 'chore', values: { title: 'Hi' } } }],
    });
    expect(core.steps[0]).toMatchObject({ actionId: coreIds.actions.create_record });

    // An action no module declares is refused.
    await expect(stepOf('stock.nope')).rejects.toThrow('Unknown action "stock.nope"');
  });
});

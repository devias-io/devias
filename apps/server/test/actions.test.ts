import { ACTIONS, AGENT_ACTIONS, coreIds } from '@devias/core';
import { agentContext, type EngineContext } from '@devias/data-engine';
import { ids as emailIds } from '@devias/mod-email-resend/manifest';
import { ids as stripeIds } from '@devias/mod-payment-stripe/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { client, createTestServer, createWorkspace, signUp } from './helpers';

describe('action registry', () => {
  let server: Server;
  let owner: EngineContext;
  let member: EngineContext;

  beforeAll(async () => {
    server = await createTestServer();
    const alice = await signUp(server, 'alice@example.com', 'Alice');
    const ws = await createWorkspace(client(server, { cookie: alice.cookie }), 'Acme', 'acme');
    owner = { workspaceId: ws.id, actor: { kind: 'user', id: alice.userId }, role: 'owner' };
    member = { ...owner, role: 'member' };
  });
  afterAll(() => server.close());

  it('records the agent, and the person it acts for, as the sender of a notification it sends', async () => {
    const agent = agentContext(owner, 'agent-1');
    // The call a generated tool makes: the action by id, as the agent.
    const sent = (await server.actions.invoke(agent, coreIds.actions.send_notification, {
      title: 'From the agent',
      to: { me: true },
    })) as { recipients: number; created: number };
    expect(sent).toMatchObject({ recipients: 1, created: 1 });

    const inbox = (await server.actions.invoke(owner, coreIds.actions.list_notifications, {})) as {
      items: { title: string; actor: unknown }[];
    };
    expect(inbox.items.find((item) => item.title === 'From the agent')?.actor).toEqual({
      kind: 'agent',
      id: 'agent-1',
      onBehalfOf: { kind: 'user', id: owner.actor.id },
    });
  });

  it('declares every action once, each on its own route', () => {
    const ids = server.actions.all().map((action) => action.spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        coreIds.actions.get_schema,
        coreIds.actions.create_object,
        coreIds.actions.delete_view,
        coreIds.actions.list_command_items,
      ]),
    );
  });

  it('invokes with a merged input, the way tools call it', async () => {
    const objects = (await server.actions.invoke(owner, coreIds.actions.list_objects, {})) as {
      id: string;
      nameSingular: string;
    }[];
    const person = objects.find((object) => object.nameSingular === 'person');
    expect(person).toBeDefined();
    const fetched = await server.actions.invoke(owner, coreIds.actions.get_object, { id: person?.id });
    expect(fetched).toMatchObject({ nameSingular: 'person' });
    const view = (await server.actions.invoke(owner, coreIds.actions.create_view, {
      objectId: person?.id,
      label: 'Registry view',
      type: 'table',
    })) as { id: string };
    const renamed = await server.actions.invoke(owner, coreIds.actions.update_view, { id: view.id, label: 'Renamed' });
    expect(renamed).toMatchObject({ id: view.id, label: 'Renamed' });
    await server.actions.invoke(owner, coreIds.actions.delete_view, { id: view.id });
    await expect(server.actions.invoke(owner, coreIds.actions.get_view, { id: view.id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('checks the declared permission before running', async () => {
    await expect(server.actions.invoke(member, coreIds.actions.get_schema, {})).resolves.toMatchObject({
      version: expect.any(Number),
    });
    await expect(
      server.actions.invoke(member, coreIds.actions.create_object, {
        nameSingular: 'ticket',
        namePlural: 'tickets',
        labelSingular: 'Ticket',
        labelPlural: 'Tickets',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('manages api keys without a session, one workspace at a time', async () => {
    const created = (await server.actions.invoke(owner, coreIds.actions.create_api_key, {
      name: 'registry',
      permissions: { record: ['read', 'write'] },
    })) as { id: string; key: string };
    const keys = (await server.actions.invoke(owner, coreIds.actions.list_api_keys, {})) as {
      id: string;
      permissions: unknown;
    }[];
    expect(keys.find((key) => key.id === created.id)?.permissions).toEqual({ record: ['read', 'write'] });
    expect(JSON.stringify(keys)).not.toContain(created.key);
    const elsewhere = { ...owner, workspaceId: 'another-workspace' };
    await expect(
      server.actions.invoke(elsewhere, coreIds.actions.delete_api_key, { id: created.id }),
    ).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await server.actions.invoke(owner, coreIds.actions.delete_api_key, { id: created.id });
    await expect(server.actions.invoke(member, coreIds.actions.list_api_keys, {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('keeps session-only actions from api keys', async () => {
    const viaKey = { workspaceId: owner.workspaceId, actor: { kind: 'api_key' as const, id: 'k' }, role: null };
    await expect(server.actions.invoke(viaKey, coreIds.actions.get_ai_settings, {})).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(server.actions.invoke(owner, coreIds.actions.get_ai_settings, {})).resolves.toHaveProperty(
      'defaultAgentId',
    );
  });

  it('rejects invalid input and unknown actions', async () => {
    await expect(server.actions.invoke(owner, coreIds.actions.get_object, {})).rejects.toThrow();
    await expect(server.actions.invoke(owner, 'nope.nothing', {})).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

/**
 * Workspace routes that are not actions, each with why. Everything else under `/api/workspaces/{workspaceId}` must be an action,
 * so the agent (and later MCP clients) can do whatever the API can.
 */
const TRANSPORT_ONLY: Record<string, string> = {
  'GET /api/workspaces/:workspaceId/events':
    'The change feed, a stream for sync clients; the agent reads history per record.',
  'GET /api/workspaces/:workspaceId/ai/status': "The agent's own transport.",
  'GET /api/workspaces/:workspaceId/ai/conversations': "The agent's own transport.",
  'POST /api/workspaces/:workspaceId/ai/conversations': "The agent's own transport.",
  'GET /api/workspaces/:workspaceId/ai/conversations/:id': "The agent's own transport.",
  'DELETE /api/workspaces/:workspaceId/ai/conversations/:id': "The agent's own transport.",
  'POST /api/workspaces/:workspaceId/ai/conversations/:id/messages': "The agent's own transport.",
  'POST /api/workspaces/:workspaceId/ai/conversations/:id/tool-calls/:toolCallId/resolve': "The agent's own transport.",
  'POST /api/workspaces/:workspaceId/ai/conversations/:id/cancel': "The agent's own transport.",
  'POST /api/workspaces/:workspaceId/assets':
    'An upload is the bytes of a file, which an action cannot carry; an agent creates files from text.',
};
/** Module routers; modules reach the agent through their declared actions. */
const MODULE_ROUTES = /^[A-Z]+ \/api\/workspaces\/:workspaceId\/mod\//;

describe('agent tool coverage', () => {
  let server: Server;
  beforeAll(async () => {
    server = await createTestServer();
  });
  afterAll(() => server.close());

  it("implements every action core declares and every registered module's, and nothing else", () => {
    const implemented = server.actions.all().map((action) => action.spec.id);
    const declared = server.registry.list().flatMap((module) => module.manifest.actions.map((action) => action.id));
    expect(declared).toEqual(
      expect.arrayContaining([emailIds.actions.send_email, stripeIds.actions.create_invoice_payment_link]),
    );
    expect([...implemented].sort()).toEqual([...ACTIONS.map((spec) => spec.id), ...declared].sort());
  });

  it('serves every action with a tool, or says why not', () => {
    const tools = new Set(server.ai.registry.all().map((tool) => tool.name));

    for (const { spec } of server.actions.all()) {
      if (spec.ai.tool === null) {
        expect(['needs_a_person', 'covered_by'], spec.id).toContain(spec.ai.category);
        expect(spec.ai.reason.length, spec.id).toBeGreaterThan(10);
      } else {
        expect(tools.has(spec.ai.tool), `${spec.id} → ${spec.ai.tool}`).toBe(true);
      }
    }
  });

  it('declares an agent action, with what a person does instead, for every core tool no action serves', () => {
    const served = new Set(server.actions.all().flatMap(({ spec }) => (spec.ai.tool === null ? [] : [spec.ai.tool])));
    const alone = server.ai.registry
      .all()
      .filter((tool) => tool.moduleId === null && !served.has(tool.name))
      .map((tool) => tool.name)
      .sort();

    expect(alone).toEqual(AGENT_ACTIONS.map((one) => one.tool).sort());

    for (const one of AGENT_ACTIONS) {
      expect(one.human.length, one.id).toBeGreaterThan(10);
      expect(one.id, one.tool).toBe(coreIds.actions[one.tool as keyof typeof coreIds.actions]);
    }
  });

  it('never serves an action with a tool looser than the action', () => {
    for (const { spec } of server.actions.all()) {
      if (spec.ai.tool === null) {
        continue;
      }

      const tool = server.ai.registry.get(spec.ai.tool);

      if (spec.approval === 'approve') {
        expect(tool?.approval, `${spec.id} → ${spec.ai.tool}`).toBe('approve');
      }

      if (spec.locked) {
        expect(tool?.locked, `${spec.id} → ${spec.ai.tool}`).toBe(true);
      }
    }
  });

  it('gives run control and the inbox tools the flags their permissions call for', () => {
    const tool = (name: string) => server.ai.registry.get(name);

    for (const name of ['stop_task_run', 'retry_task']) {
      expect(tool(name), name).toMatchObject({ approval: 'approve', locked: true, escalates: true, readOnly: false });
    }

    // Marking read is the person's own housekeeping; deleting and clearing the inbox ask first. None of them only reads.
    expect(tool('mark_notification_read')).toMatchObject({ approval: 'auto', readOnly: false });
    expect(tool('mark_notification_unread')).toMatchObject({ approval: 'auto', readOnly: false });
    expect(tool('mark_all_notifications_read')).toMatchObject({ approval: 'approve', readOnly: false });
    expect(tool('delete_notification')).toMatchObject({ approval: 'approve', readOnly: false });
    expect(tool('count_unread_notifications')).toMatchObject({ approval: 'auto', readOnly: true });
  });

  it('describes every tool for the model', () => {
    for (const tool of server.ai.registry.all()) {
      expect(tool.description.trim().length, tool.name).toBeGreaterThan(10);
    }
  });

  it('never lets a workspace override hand access to the agent', () => {
    const granting = new Set(['apikey.manage', 'member.manage', 'ai.manage']);

    for (const { spec } of server.actions.all()) {
      if (spec.http.method !== 'get' && granting.has(spec.permission)) {
        expect(spec.locked, spec.id).toBe(true);
      }
    }
  });

  it('has no workspace route outside the registry except the listed transports', () => {
    const actions = new Set(
      server.actions
        .all()
        .map(({ spec }) => `${spec.http.method.toUpperCase()} ${spec.http.path.replace(/\{(\w+)\}/g, ':$1')}`),
    );
    const stray = [
      ...new Set(server.app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`)),
    ].filter(
      (route) =>
        route.includes(' /api/workspaces/:workspaceId/') &&
        !actions.has(route) &&
        !(route in TRANSPORT_ONLY) &&
        !MODULE_ROUTES.test(route),
    );
    expect(stray).toEqual([]);
  });
});

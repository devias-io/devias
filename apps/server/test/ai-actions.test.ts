import { createFakeModelClient, text, toolUse } from '@devias/ai/testing';
import type { ChatEvent } from '@devias/core';
import { toolOfAction } from '@devias/core';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import { crm } from '@devias/mod-crm/server';
import { emailResend } from '@devias/mod-email-resend/server';
import { invoicing } from '@devias/mod-invoicing/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, readChatEvents, type Session, signUp } from './helpers';

/** The agent reaches actions no hand-written tool serves through tools generated from their specs. */
describe('agent tools from actions', () => {
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
        modules: [crm, invoicing, emailResend],
        builtin: [crmManifest],
        pgliteDataDir: 'memory://',
        modelClient: model,
      },
    );
    alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    ws = await createWorkspace(api, 'Acme', 'acme');
    base = `/api/workspaces/${ws.id}/ai`;
  });
  afterAll(() => server.close());

  const send = async (
    cookie: string,
    content: string,
    agentId?: string,
  ): Promise<{ conversationId: string; events: ChatEvent[] }> => {
    const conversation = (
      await client(server, { cookie })(`${base}/conversations`, { body: agentId ? { agentId } : {} })
    ).json as {
      id: string;
    };
    const response = await server.app.request(`${base}/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ content }),
    });

    return { conversationId: conversation.id, events: await readChatEvents(response) };
  };

  const approve = async (conversationId: string, events: ChatEvent[], cookie = alice.cookie) => {
    const pause = events.find((event) => event.type === 'paused');
    const pendingId = pause?.type === 'paused' ? pause.pending[0]?.id : undefined;
    expect(pendingId).toBeDefined();
    const response = await server.app.request(
      `${base}/conversations/${conversationId}/tool-calls/${pendingId}/resolve`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ approved: true }),
      },
    );

    return await readChatEvents(response);
  };

  const resultOf = (events: ChatEvent[]) => {
    const result = events.find((event) => event.type === 'tool_result');

    return result?.type === 'tool_result' ? result : undefined;
  };

  it('offers generated tools next to the hand-written ones, by permission', async () => {
    const owner = (await api(`${base}/status`)).json as {
      tools: { name: string; approval: string; locked?: boolean }[];
    };
    const names = owner.tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'create_record',
        'install_module',
        'uninstall_module',
        'update_object',
        'delete_view',
        'list_layouts',
        'add_record_note',
        'list_members',
        'invite_member',
        'list_api_keys',
      ]),
    );
    expect(owner.tools.find((tool) => tool.name === 'invite_member')).toMatchObject({ approval: 'approve' });

    const carol = await signUp(server, 'carol@example.com', 'Carol');
    await server.auth.api.addMember({ body: { userId: carol.userId, organizationId: ws.id, role: 'member' } });
    const member = (await client(server, { cookie: carol.cookie })(`${base}/status`)).json as {
      tools: { name: string }[];
    };
    const memberNames = member.tools.map((tool) => tool.name);
    expect(memberNames).toEqual(expect.arrayContaining(['list_members', 'add_record_note', 'list_records']));

    for (const hidden of ['install_module', 'list_api_keys', 'invite_member', 'update_object']) {
      expect(memberNames).not.toContain(hidden);
    }
  });

  it('installs a module from the catalog after approval', async () => {
    model.push(
      {
        content: [
          toolUse('list_module_catalog', {}, 'tu_cat'),
          toolUse('install_module', { module: 'email-resend' }, 'tu_inst'),
        ],
      },
      { content: [text('Resend is installed.')] },
    );
    const { conversationId, events } = await send(alice.cookie, 'install resend');
    const catalog = resultOf(events);
    expect(catalog?.status).toBe('executed');
    expect(JSON.stringify(catalog?.result)).toContain('"installedVersion":null');
    // The install waits on a card that says what the module may do; agreeing there is the approval.
    const card = events.flatMap((event) =>
      event.type === 'tool_call' && event.toolCall.inputRequest ? [event.toolCall.inputRequest] : [],
    )[0];
    expect(card).toMatchObject({
      title: 'Install Email via Resend',
      fields: [],
      consent: { module: 'email-resend', fromVersion: null, publisher: expect.any(String) },
    });

    const resolved = await approve(conversationId, events);
    const installed = resultOf(resolved);
    expect(installed).toMatchObject({
      status: 'executed',
      result: expect.objectContaining({ installed: true, module: 'email-resend' }),
    });
    const modules = (await api(`/api/workspaces/${ws.id}/modules`)).json as { moduleId: string }[];
    expect(modules.map((module) => module.moduleId)).toContain('email-resend');
  });

  it('explains who publishes a module and its default policies before proposing it', async () => {
    model.push({ content: [toolUse('list_module_catalog', {}, 'tu_ask')] }, { content: [text('It may only …')] });
    const { events } = await send(alice.cookie, 'What does installing Invoicing allow it to do?');
    const catalog = resultOf(events)?.result as { modules: Record<string, unknown>[] };
    const entry = catalog.modules.find((module) => module.id === 'invoicing');
    expect(entry).toMatchObject({
      publisher: 'Devias',
      policies: [
        { description: 'Adding a payment always needs review.', decision: 'review' },
        { description: 'Invoices over 5,000 need review.', decision: 'review' },
      ],
      installedVersion: null,
    });
  });

  it('runs a generated read tool without asking, and a generated write after approval', async () => {
    const company = (await api(`/api/workspaces/${ws.id}/records/company`, { body: { name: 'Globex' } })).json as {
      id: string;
    };
    model.push(
      { content: [toolUse('list_members', {}, 'tu_members')] },
      {
        content: [
          toolUse(
            'add_record_note',
            { object: 'company', id: company.id, title: 'Call', body: 'Called them today.' },
            'tu_c',
          ),
        ],
      },
      { content: [text('Done.')] },
    );
    const { conversationId, events } = await send(alice.cookie, 'who is here, then note the call');
    const members = resultOf(events);
    expect(members?.status).toBe('executed');
    expect(JSON.stringify(members?.result)).toContain('alice@example.com');
    expect(events.find((event) => event.type === 'paused')).toBeDefined();

    const resolved = await approve(conversationId, events);
    expect(resultOf(resolved)).toMatchObject({ status: 'executed' });
    const notes = (await api(`/api/workspaces/${ws.id}/records/company/${company.id}/notes`)).json as {
      items: { title: string; body: string }[];
    };
    expect(notes.items).toContainEqual(expect.objectContaining({ title: 'Call', body: 'Called them today.' }));
  });

  it("gives a workspace the CRM's sales agent, with every tool it names, and nothing that reaches beyond records", async () => {
    const agents = (await api(`${base}/agents`)).json as {
      name: string;
      moduleId: string | null;
      tools: string[] | null;
    }[];
    const sales = agents.find((agent) => agent.name === 'Sales');
    expect(sales).toMatchObject({ moduleId: 'crm' });
    // Every id in the manifest answers to a tool, so none was dropped; the agent cannot delete or manage anything.
    const declared = (crmManifest.agents.find((agent) => agent.name === 'Sales')?.actionIds ?? []).flatMap(
      (id) => toolOfAction(id) ?? [],
    );
    expect(sales?.tools).toEqual(declared);
    const status = (await api(`${base}/status`)).json as { tools: { name: string; escalates: boolean }[] };
    const known = new Map(status.tools.map((tool) => [tool.name, tool]));

    for (const name of declared) {
      expect(known.get(name), name).toBeDefined();
      expect(known.get(name)?.escalates, name).toBe(false);
    }

    expect(declared).not.toContain('delete_records');
    expect(declared).toContain('aggregate_records');
  });

  it('records what it does as the agent acting for the person', async () => {
    const [general] = (await api(`${base}/agents`)).json as { id: string }[];
    model.push(
      { content: [toolUse('create_record', { object: 'company', data: { name: 'Initech' } }, 'tu_new')] },
      { content: [text('Created.')] },
    );
    const { events } = await send(alice.cookie, 'add Initech');
    const created = resultOf(events)?.result as { id: string };
    const record = (await api(`/api/workspaces/${ws.id}/records/company/${created.id}`)).json as { created_by: string };
    expect(record.created_by).toBe(`agent:${general?.id}@user:${alice.userId}`);
    const activity = (await api(`/api/workspaces/${ws.id}/records/company/${created.id}/activity`)).json as {
      items: { kind: string; actor: unknown }[];
    };
    expect(activity.items.find((item) => item.kind === 'created')?.actor).toEqual({
      kind: 'agent',
      id: general?.id,
      onBehalfOf: { kind: 'user', id: alice.userId },
    });
  });

  it('lets a member remove a note their agent wrote, as their own', async () => {
    const dana = await signUp(server, 'dana@example.com', 'Dana');
    await server.auth.api.addMember({ body: { userId: dana.userId, organizationId: ws.id, role: 'member' } });
    const company = (await api(`/api/workspaces/${ws.id}/records/company`, { body: { name: 'Hooli' } })).json as {
      id: string;
    };
    model.push(
      { content: [toolUse('add_record_note', { object: 'company', id: company.id, title: 'Met them.' }, 'tu_dc')] },
      { content: [text('Noted.')] },
    );
    const { conversationId, events } = await send(dana.cookie, 'note the meeting');
    const resolved = await approve(conversationId, events, dana.cookie);
    const note = resultOf(resolved)?.result as { id: string };
    const remove = await client(server, { cookie: dana.cookie })(
      `/api/workspaces/${ws.id}/records/company/${company.id}/notes/${note.id}`,
      { method: 'DELETE' },
    );
    expect(remove.status).toBe(204);
  });

  it("keeps an agent to its tool list, whatever the person's role", async () => {
    const reader = (await api(`${base}/agents`, { body: { name: 'Reader', tools: ['list_records'] } })).json as {
      id: string;
    };
    model.push(
      { content: [toolUse('create_record', { object: 'company', data: { name: 'Nope Inc' } }, 'tu_no')] },
      { content: [text('I cannot.')] },
    );
    const { events } = await send(alice.cookie, 'add Nope Inc', reader.id);
    expect(model.requests.at(-1)?.tools.map((tool) => tool.name)).toEqual(['list_records']);
    expect(resultOf(events)).toMatchObject({ status: 'failed', result: { error: { code: 'UNKNOWN_TOOL' } } });
    const query = (await api(`/api/workspaces/${ws.id}/records/company/list`, { body: {} })).json as {
      items: { name: string }[];
    };
    expect(query.items.map((item) => item.name)).not.toContain('Nope Inc');
  });
});

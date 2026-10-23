import { createFakeModelClient, text, toolUse } from '@devias/ai/testing';
import type { ChatEvent } from '@devias/core';
import { manifest as crmManifest } from '@devias/mod-crm/manifest';
import { crm } from '@devias/mod-crm/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from '../src/boot';
import { loadConfig } from '../src/config';
import { type Api, client, createWorkspace, readChatEvents as readAll, type Session, signUp } from './helpers';

const config = () =>
  loadConfig({
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0000',
    MIGRATE_ON_BOOT: 'true',
    LOG_LEVEL: 'error',
  });

describe('agents API', () => {
  let server: Server;
  let alice: Session;
  let api: Api;
  let ws: { id: string; slug: string };
  let base: string;
  const model = createFakeModelClient([], { delayMs: 0 });

  beforeAll(async () => {
    server = await createServer(config(), {
      modules: [crm],
      builtin: [crmManifest],
      pgliteDataDir: 'memory://',
      modelClient: model,
    });
    alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    ws = await createWorkspace(api, 'Acme', 'acme');
    base = `/api/workspaces/${ws.id}/ai`;
  });
  afterAll(() => server.close());

  it("documents the routes and reports status with the caller's tools", async () => {
    const doc = (await client(server)('/api/openapi.json')).json as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/workspaces/{workspaceId}/ai/status',
        '/api/workspaces/{workspaceId}/ai/conversations',
        '/api/workspaces/{workspaceId}/ai/conversations/{id}/messages',
        '/api/workspaces/{workspaceId}/ai/conversations/{id}/tool-calls/{toolCallId}/resolve',
        '/api/workspaces/{workspaceId}/ai/settings',
      ]),
    );
    expect(Object.keys(doc.components.schemas)).toEqual(
      expect.arrayContaining(['ChatEvent', 'ConversationThread', 'AiStatus']),
    );

    const status = await api(`${base}/status`);
    expect(status.status).toBe(200);
    const body = status.json as { configured: boolean; model: string; canManage: boolean; tools: { name: string }[] };
    expect(body).toMatchObject({ configured: true, model: 'fake-model', canManage: true });
    expect(body.tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(['create_record', 'delete_field', 'aggregate_records']),
    );
  });

  it('streams a turn as SSE, persists it, and serves the thread afterwards', async () => {
    model.push({ content: [toolUse('list_objects', {}, 'tu1')] }, { content: [text('Five objects.')] });
    const created = await api(`${base}/conversations`, { body: { title: 'First' } });
    expect(created.status).toBe(201);
    const conversation = created.json as { id: string };

    const response = await server.app.request(`${base}/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ content: 'how many objects?', context: { page: { object: 'person' } } }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const events = await readAll(response);
    expect(events[0]?.type).toBe('turn_start');
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['message_start', 'tool_call', 'tool_result', 'text_delta', 'message_stop', 'done']),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'completed' });

    const thread = await api(`${base}/conversations/${conversation.id}`);
    expect(thread.status).toBe(200);
    const body = thread.json as {
      messages: { role: string; blocks: { type: string }[]; context?: unknown }[];
      activeTurn: unknown;
    };
    expect(body.activeTurn).toBeNull();
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'assistant']);
    expect(body.messages[0]?.context).toEqual({ page: { object: 'person' } });
    expect(body.messages[1]?.blocks.map((b) => b.type)).toEqual(['tool_use']);
    const list = await api(`${base}/conversations`);
    expect((list.json as { id: string }[]).map((c) => c.id)).toContain(conversation.id);
  });

  it('pauses for approval, rejects a concurrent send with 409, and continues on resolve', async () => {
    const company = await api(`/api/workspaces/${ws.id}/records/company`, { body: { name: 'Doomed' } });
    const companyId = (company.json as { id: string }).id;
    model.push(
      { content: [toolUse('delete_records', { object: 'company', ids: [companyId] }, 'tu_del')] },
      { content: [text('Deleted.')] },
    );
    const conversation = (await api(`${base}/conversations`, { body: {} })).json as { id: string };
    const paused = await readAll(
      await server.app.request(`${base}/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ content: 'delete Doomed' }),
      }),
    );
    const pause = paused.find((e) => e.type === 'paused');
    expect(pause?.type).toBe('paused');
    const pendingId = pause?.type === 'paused' ? pause.pending[0]?.id : undefined;
    expect(pendingId).toBeDefined();

    const conflict = await api(`${base}/conversations/${conversation.id}/messages`, { body: { content: 'again' } });
    expect(conflict.status).toBe(409);
    const invalid = await api(`${base}/conversations/${conversation.id}/tool-calls/${pendingId}/resolve`, { body: {} });
    expect(invalid.status).toBe(400);

    const resolved = await readAll(
      await server.app.request(`${base}/conversations/${conversation.id}/tool-calls/${pendingId}/resolve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ approved: true }),
      }),
    );
    expect(resolved.find((e) => e.type === 'tool_result')).toMatchObject({ status: 'executed' });
    expect(resolved.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    expect((await api(`/api/workspaces/${ws.id}/records/company/${companyId}`)).status).toBe(404);
    expect((await api(`${base}/conversations/${conversation.id}/cancel`, { method: 'POST' })).json).toBeNull();
  });

  it('builds a workflow and runs it through the server runner, each after approval', async () => {
    const company = await api(`/api/workspaces/${ws.id}/records/company`, { body: { name: 'Wired Inc' } });
    const companyId = (company.json as { id: string }).id;
    const approve = async (conversationId: string, events: ChatEvent[]) => {
      const pause = events.find((e) => e.type === 'paused');
      const pendingId = pause?.type === 'paused' ? pause.pending[0]?.id : undefined;
      expect(pendingId).toBeDefined();

      return readAll(
        await server.app.request(`${base}/conversations/${conversationId}/tool-calls/${pendingId}/resolve`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: alice.cookie },
          body: JSON.stringify({ approved: true }),
        }),
      );
    };
    const say = async (conversationId: string, content: string) =>
      readAll(
        await server.app.request(`${base}/conversations/${conversationId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', cookie: alice.cookie },
          body: JSON.stringify({ content }),
        }),
      );
    model.push(
      {
        content: [
          toolUse(
            'create_workflow',
            {
              title: 'Mark as software',
              trigger: { kind: 'manual', objectId: 'Companies' },
              steps: [
                {
                  id: 'tag',
                  kind: 'action',
                  actionId: 'core.update_record',
                  input: { object: 'Companies', id: '{{record.id}}', values: { Industry: 'software' } },
                },
              ],
            },
            'tu_wf_create',
          ),
        ],
      },
      { content: [text('Created.')] },
      { content: [toolUse('run_workflow', { workflow: 'Mark as software', recordId: companyId }, 'tu_wf_run')] },
      { content: [text('Done.')] },
    );
    const conversation = (await api(`${base}/conversations`, { body: {} })).json as { id: string; agentId: string };
    const created = await approve(conversation.id, await say(conversation.id, 'add a button that tags software'));
    expect(created.find((e) => e.type === 'tool_result')).toMatchObject({ status: 'executed', isError: false });
    const workflows = (await api(`/api/workspaces/${ws.id}/workflows`)).json as { id: string; title: string }[];
    const workflow = workflows.find((w) => w.title === 'Mark as software');
    expect(workflow).toBeDefined();

    const ran = await approve(conversation.id, await say(conversation.id, 'run it on Wired Inc'));
    const result = ran.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({
      status: 'executed',
      result: {
        status: 'succeeded',
        record: `record:company/${companyId}`,
        trigger: {
          kind: 'manual',
          actor: { kind: 'agent', id: conversation.agentId, onBehalfOf: { kind: 'user', id: alice.userId } },
        },
      },
    });
    expect(
      ((await api(`/api/workspaces/${ws.id}/records/company/${companyId}`)).json as { industry: string }).industry,
    ).toBe('software');
    const runs = (await api(`/api/workspaces/${ws.id}/workflows/${workflow?.id}/runs`)).json as { items: unknown[] };
    expect(runs.items).toHaveLength(1);
  });

  it('enforces who may use and manage the agent', async () => {
    const key = await api(`/api/workspaces/${ws.id}/api-keys`, {
      body: { name: 'ci', permissions: { record: ['read', 'write'] } },
    });
    const apiKey = client(server, { apiKey: (key.json as { key: string }).key });
    expect((await apiKey(`${base}/status`)).status).toBe(403);

    const bob = await signUp(server, 'bob@example.com', 'Bob');
    const invite = await server.auth.api.createInvitation({
      body: { email: 'bob@example.com', role: 'member', organizationId: ws.id },
      headers: new Headers({ cookie: alice.cookie }),
    });
    await server.auth.api.acceptInvitation({
      body: { invitationId: invite.id },
      headers: new Headers({ cookie: bob.cookie }),
    });
    const bobApi = client(server, { cookie: bob.cookie });
    const status = await bobApi(`${base}/status`);
    expect(status.status).toBe(200);
    expect((status.json as { canManage: boolean }).canManage).toBe(false);
    // The settings are the workspace's, so members may read them and only admins change them. How tools ask is each
    // agent's own: a workspace-wide approvals setting is gone, and a body that still carries one is ignored.
    expect((await bobApi(`${base}/settings`, { method: 'PATCH', body: { defaultAgentId: null } })).status).toBe(403);
    const ignored = await api(`${base}/settings`, {
      method: 'PATCH',
      body: { approvalOverrides: { delete_records: 'auto' } },
    });
    expect(ignored.status).toBe(200);
    expect(ignored.json).not.toHaveProperty('approvalOverrides');
    // Tools say what they do by themselves, and which always ask, in the catalog.
    const catalog = (
      (await api(`${base}/status`)).json as { tools: { name: string; approval: string; locked: boolean }[] }
    ).tools;
    expect(catalog.find((tool) => tool.name === 'delete_records')).toMatchObject({
      approval: 'approve',
      locked: false,
    });
    expect(catalog.find((tool) => tool.name === 'delete_field')).toMatchObject({ approval: 'approve', locked: true });
    // An agent's own modes are checked: the tools that always ask cannot be loosened.
    expect(
      (await api(`${base}/agents`, { body: { name: 'Careless', approvalOverrides: { delete_field: 'auto' } } })).status,
    ).toBe(400);

    // The default agent is the workspace's choice; only admins change it, and it must be an active agent.
    const agentList = (await bobApi(`${base}/agents`)).json as { id: string; name: string }[];
    // The CRM is installed, so its Sales agent is here from the start.
    expect(agentList.map((a) => a.name)).toEqual(['Assistant', 'Sales']);
    const general = agentList[0] as { id: string };
    expect((await bobApi(`${base}/settings`)).json).toMatchObject({ defaultAgentId: general.id });
    expect((await bobApi(`${base}/settings`, { method: 'PATCH', body: { defaultAgentId: null } })).status).toBe(403);
    expect((await api(`${base}/settings`, { method: 'PATCH', body: { defaultAgentId: 'missing' } })).status).toBe(404);
    expect((await api(`${base}/settings`, { method: 'PATCH', body: { defaultAgentId: null } })).json).toMatchObject({
      defaultAgentId: null,
    });
    // Without a choice a conversation still gets the first active agent.
    expect(((await bobApi(`${base}/conversations`, { body: {} })).json as { agentId: string }).agentId).toBe(
      general.id,
    );
    await api(`${base}/settings`, { method: 'PATCH', body: { defaultAgentId: general.id } });

    // Starter prompts belong to agents: at most five of at most 120 characters.
    expect(
      (await api(`${base}/agents`, { body: { name: 'Many', starterPrompts: ['a', 'b', 'c', 'd', 'e', 'f'] } })).status,
    ).toBe(400);
    expect((await api(`${base}/agents`, { body: { name: 'Long', starterPrompts: ['x'.repeat(121)] } })).status).toBe(
      400,
    );
    expect((await api(`${base}/agents`, { body: { name: 'Empty', tools: [] } })).status).toBe(400);

    // conversations are private
    const mine = (await api(`${base}/conversations`, { body: {} })).json as { id: string };
    expect((await bobApi(`${base}/conversations/${mine.id}`)).status).toBe(404);
  });

  it('lets owners shape agents, everyone pick one, and narrows the turn to it', async () => {
    const doc = (await client(server)('/api/openapi.json')).json as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/workspaces/{workspaceId}/ai/agents',
        '/api/workspaces/{workspaceId}/ai/agents/{id}',
      ]),
    );
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(['AiAgent', 'AiAgentInput']));

    const dave = await signUp(server, 'dave@example.com', 'Dave');
    const invite = await server.auth.api.createInvitation({
      body: { email: 'dave@example.com', role: 'member', organizationId: ws.id },
      headers: new Headers({ cookie: alice.cookie }),
    });
    await server.auth.api.acceptInvitation({
      body: { invitationId: invite.id },
      headers: new Headers({ cookie: dave.cookie }),
    });
    const daveApi = client(server, { cookie: dave.cookie });
    expect((await daveApi(`${base}/agents`, { body: { name: 'Nope' } })).status).toBe(403);
    expect((await api(`${base}/agents`, { body: { name: 'Sales', tools: ['list_records', 'fly'] } })).status).toBe(400);

    const created = await api(`${base}/agents`, {
      body: {
        name: 'Sales',
        description: 'Pipeline only',
        instructions: 'Talk about deals.',
        tools: ['list_records', 'lookup_records'],
        starterPrompts: ['  see the open deals ', 'see the open deals', 'plan next week'],
      },
    });
    expect(created.status).toBe(201);
    const agent = created.json as { id: string; name: string; tools: string[] };
    // Starter prompts are trimmed and kept once, in the order written.
    expect(agent).toMatchObject({
      name: 'Sales',
      tools: ['list_records', 'lookup_records'],
      starterPrompts: ['see the open deals', 'plan next week'],
    });
    expect(((await daveApi(`${base}/agents`)).json as { name: string }[]).map((a) => a.name)).toEqual([
      'Assistant',
      'Sales',
      'Sales',
    ]);
    expect((await api(`${base}/conversations`, { body: { agentId: 'missing' } })).status).toBe(404);

    model.push({ content: [text('Only deals here.')] });
    const conversation = (await daveApi(`${base}/conversations`, { body: { agentId: agent.id } })).json as {
      id: string;
      agentId: string;
    };
    expect(conversation.agentId).toBe(agent.id);
    const events = await readAll(
      await server.app.request(`${base}/conversations/${conversation.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: dave.cookie },
        body: JSON.stringify({ content: 'what can you do?' }),
      }),
    );
    expect(events.at(-1)).toMatchObject({ type: 'done', status: 'completed' });
    const request = model.requests.at(-1);
    expect(request?.instructions).toContain('You are "Sales"');
    // Its list, and use_skill: the CRM that is installed here has a skill, and an agent may use every skill by default.
    expect(request?.tools.map((t) => t.name)).toEqual(['list_records', 'lookup_records', 'use_skill']);
    expect(request?.instructions).toContain('- Close out a deal:');

    const renamed = await api(`${base}/agents/${agent.id}`, { method: 'PATCH', body: { name: 'Pipeline' } });
    expect(renamed.status).toBe(200);
    expect((renamed.json as { name: string }).name).toBe('Pipeline');
    // Deleting archives: the thread stays readable with its agent, and nothing new can start with it.
    expect((await daveApi(`${base}/agents/${agent.id}`, { method: 'DELETE' })).status).toBe(403);
    expect((await api(`${base}/agents/${agent.id}`, { method: 'DELETE' })).status).toBe(204);
    const thread = (await daveApi(`${base}/conversations/${conversation.id}`)).json as {
      conversation: { agentId: string };
    };
    expect(thread.conversation.agentId).toBe(agent.id);
    const names = async (query = '') =>
      ((await daveApi(`${base}/agents${query}`)).json as { name: string }[]).map((a) => a.name);
    expect(await names()).toEqual(['Assistant', 'Sales']);
    expect(await names('?includeArchived=true')).toEqual(['Assistant', 'Pipeline', 'Sales']);
    expect((await daveApi(`${base}/conversations`, { body: { agentId: agent.id } })).status).toBe(409);
    const refused = await server.app.request(`${base}/conversations/${conversation.id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: dave.cookie },
      body: JSON.stringify({ content: 'still there?' }),
    });
    expect(refused.status).toBe(409);

    const restored = await api(`${base}/agents/${agent.id}`, { method: 'PATCH', body: { archived: false } });
    expect((restored.json as { archivedAt: string | null }).archivedAt).toBeNull();
    expect(await names()).toEqual(['Assistant', 'Pipeline', 'Sales']);
  });

  it('tells owners and admins how much each agent has been used, and nobody else', async () => {
    const usage = await api(`${base}/agents/usage`);
    expect(usage.status).toBe(200);
    const rows = usage.json as { agentId: string; conversations: number; usage: { inputTokens: number } }[];
    const agents = (await api(`${base}/agents?includeArchived=true`)).json as { id: string; name: string }[];
    // Every agent has a row, archived or not; the Pipeline agent has the member's conversation from the test above.
    expect(rows.map((row) => row.agentId).sort()).toEqual(agents.map((agent) => agent.id).sort());
    const pipeline = rows.find((row) => row.agentId === agents.find((agent) => agent.name === 'Pipeline')?.id);
    expect(pipeline?.conversations).toBeGreaterThanOrEqual(1);
    expect(pipeline?.usage.inputTokens).toBeGreaterThan(0);
    const member = await signUp(server, 'erin@example.com', 'Erin');
    const invite = await server.auth.api.createInvitation({
      body: { email: 'erin@example.com', role: 'member', organizationId: ws.id },
      headers: new Headers({ cookie: alice.cookie }),
    });
    await server.auth.api.acceptInvitation({
      body: { invitationId: invite.id },
      headers: new Headers({ cookie: member.cookie }),
    });
    expect((await client(server, { cookie: member.cookie })(`${base}/agents/usage`)).status).toBe(403);

    // One agent per day: the same two knobs as workflow activity, and the same rule for who sees it.
    const pipelineId = agents.find((agent) => agent.name === 'Pipeline')?.id;
    const activity = await api(`${base}/agents/${pipelineId}/activity?days=3&tz=UTC`);
    expect(activity.status).toBe(200);
    const days = (activity.json as { days: { date: string; messages: number; inputTokens: number }[] }).days;
    expect(days).toHaveLength(3);
    expect(days.reduce((sum, day) => sum + day.messages, 0)).toBeGreaterThanOrEqual(1);
    expect((await api(`${base}/agents/${pipelineId}/activity?tz=Mars/Olympus`)).status).toBe(400);
    expect((await api(`${base}/agents/missing/activity`)).status).toBe(404);
    expect((await client(server, { cookie: member.cookie })(`${base}/agents/${pipelineId}/activity`)).status).toBe(403);
  });

  it('lets owners and admins write skills, validates them, and gives an agent a list of them', async () => {
    const doc = (await client(server)('/api/openapi.json')).json as {
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
    };
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/api/workspaces/{workspaceId}/ai/skills',
        '/api/workspaces/{workspaceId}/ai/skills/{id}',
      ]),
    );
    expect(Object.keys(doc.components.schemas)).toEqual(expect.arrayContaining(['AiSkill', 'AiSkillInput']));

    const created = await api(`${base}/skills`, {
      body: { title: ' Qualify a lead ', description: 'When a new lead arrives', body: '1. Look it up\n2. Score it' },
    });
    expect(created.status).toBe(201);
    const skill = created.json as { id: string; title: string; body: string };
    expect(skill).toMatchObject({ title: 'Qualify a lead', body: '1. Look it up\n2. Score it' });

    // The list leaves out the text; one skill read by id has it.
    const listed = (await api(`${base}/skills`)).json as { id: string; moduleId: string | null }[];
    // The CRM that is installed here ships one.
    expect(listed.map((row) => row.id).sort()).toEqual(['crm.close_deal', skill.id].sort());
    expect(listed.find((row) => row.id === 'crm.close_deal')).toMatchObject({ moduleId: 'crm' });
    expect(listed[0]).not.toHaveProperty('body');
    expect(((await api(`${base}/skills/${skill.id}`)).json as { body: string }).body).toContain('Score it');

    // What is wrong with a skill is a 400, a clash is a 409, a missing one is a 404.
    expect((await api(`${base}/skills`, { body: { title: '', description: 'x', body: 'y' } })).status).toBe(400);
    expect(
      (await api(`${base}/skills`, { body: { title: 'T', description: 'x'.repeat(301), body: 'y' } })).status,
    ).toBe(400);
    expect(
      (await api(`${base}/skills`, { body: { title: 'T', description: 'x', body: 'y'.repeat(20_001) } })).status,
    ).toBe(400);
    expect(
      (await api(`${base}/skills`, { body: { title: 'qualify a lead', description: 'x', body: 'y' } })).status,
    ).toBe(409);
    expect((await api(`${base}/skills/missing`)).status).toBe(404);

    // Only people who manage agents see or write skills.
    const member = await signUp(server, 'frank@example.com', 'Frank');
    const invite = await server.auth.api.createInvitation({
      body: { email: 'frank@example.com', role: 'member', organizationId: ws.id },
      headers: new Headers({ cookie: alice.cookie }),
    });
    await server.auth.api.acceptInvitation({
      body: { invitationId: invite.id },
      headers: new Headers({ cookie: member.cookie }),
    });
    const memberApi = client(server, { cookie: member.cookie });
    expect((await memberApi(`${base}/skills`)).status).toBe(403);
    expect((await memberApi(`${base}/skills/${skill.id}`)).status).toBe(403);
    expect((await memberApi(`${base}/skills`, { body: { title: 'Mine', description: 'x', body: 'y' } })).status).toBe(
      403,
    );

    // An agent gets all skills, or a list of the ones that exist.
    const sales = (await api(`${base}/agents`, { body: { name: 'Skilled', skills: [skill.id] } })).json as {
      id: string;
      skills: string[];
    };
    expect(sales.skills).toEqual([skill.id]);
    expect((await api(`${base}/agents`, { body: { name: 'Lost', skills: ['workspace.nope'] } })).status).toBe(400);

    // Archiving takes the skill from the list, and from nothing else.
    expect((await api(`${base}/skills/${skill.id}`, { method: 'DELETE' })).status).toBe(204);
    expect(((await api(`${base}/skills`)).json as { id: string }[]).map((row) => row.id)).toEqual(['crm.close_deal']);
    expect(((await api(`${base}/skills?includeArchived=true`)).json as unknown[]).length).toBe(2);
    const restored = await api(`${base}/skills/${skill.id}`, { method: 'PATCH', body: { archived: false } });
    expect((restored.json as { archivedAt: string | null }).archivedAt).toBeNull();
  });

  it('reports "not configured" and refuses turns when no model is set', async () => {
    const bare = await createServer(config(), {
      modules: [crm],
      pgliteDataDir: 'memory://',
      modelClient: null,
    });

    try {
      const carol = await signUp(bare, 'carol@example.com', 'Carol');
      const carolApi = client(bare, { cookie: carol.cookie });
      const space = await createWorkspace(carolApi, 'Bare', 'bare');
      const status = await carolApi(`/api/workspaces/${space.id}/ai/status`);
      expect((status.json as { configured: boolean }).configured).toBe(false);
      const conversation = (await carolApi(`/api/workspaces/${space.id}/ai/conversations`, { body: {} })).json as {
        id: string;
      };
      const send = await carolApi(`/api/workspaces/${space.id}/ai/conversations/${conversation.id}/messages`, {
        body: { content: 'hi' },
      });
      expect(send.status).toBe(422);
      expect((send.json as { error: { code: string } }).error.code).toBe('MISSING_DEPENDENCY');
    } finally {
      await bare.close();
    }
  });
});

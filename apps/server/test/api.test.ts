import { coreIds } from '@devias/core';
import { ids as crmIds } from '@devias/mod-crm/manifest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { type Api, client, createTestServer, createWorkspace, readSse, type Session, signIn, signUp } from './helpers';

describe('API on PGlite', () => {
  let server: Server;
  let alice: Session;
  let erin: Session;
  let api: Api;
  let ws: { id: string; slug: string };
  let base: string;

  beforeAll(async () => {
    server = await createTestServer();
    alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    ws = await createWorkspace(api, 'Acme', 'acme');
    base = `/api/workspaces/${ws.id}`;
    // A member of the workspace, for the notification and feed-visibility cases.
    erin = await signUp(server, 'erin@example.com', 'Erin');
    await server.auth.api.addMember({ body: { userId: erin.userId, organizationId: ws.id, role: 'member' } });
  });
  afterAll(() => server.close());

  it('serves health and the OpenAPI document without authentication', async () => {
    const anon = client(server);
    const health = await anon('/api/health');
    expect(health.status).toBe(200);
    expect(health.json).toEqual({ ok: true, db: 'pglite' });
    const doc = await anon('/api/openapi.json');
    expect(doc.status).toBe(200);
    const paths = Object.keys((doc.json as { paths: Record<string, unknown> }).paths);
    expect(paths).toContain('/api/workspaces/{workspaceId}/records/{object}/list');
    expect(paths).toContain('/api/workspaces/{workspaceId}/events');
    const components = (
      doc.json as { components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> } }
    ).components;
    expect(Object.keys(components.securitySchemes).sort()).toEqual(['apiKeyAuth', 'cookieAuth']);
    expect(Object.keys(components.schemas)).toEqual(
      expect.arrayContaining(['Query', 'RecordData', 'WorkspaceSchema', 'PlanResult', 'ApiError']),
    );
  });

  it('signs in with email + password and lists the user and workspaces on /api/me', async () => {
    const cookie = await signIn(server, 'alice@example.com');
    const me = await client(server, { cookie })('/api/me');
    expect(me.status).toBe(200);
    expect(me.json).toEqual({
      user: expect.objectContaining({ id: alice.userId, email: 'alice@example.com', name: 'Alice' }),
      workspaces: [{ id: ws.id, name: 'Acme', slug: 'acme', role: 'owner' }],
    });
    const list = await api('/api/workspaces');
    expect(list.json).toEqual([{ id: ws.id, name: 'Acme', slug: 'acme', role: 'owner' }]);
    const dup = await api('/api/workspaces', { body: { name: 'Acme again', slug: 'acme' } });
    expect(dup.status).toBe(400);
  });

  it('returns 401 without a session and 403 for non-members', async () => {
    const anon = client(server);
    expect((await anon('/api/me')).status).toBe(401);
    expect((await anon(`${base}/metadata`)).status).toBe(401);
    const body = (await anon(`${base}/metadata`)).json as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
    const bob = await signUp(server, 'bob@example.com', 'Bob');
    const response = await client(server, { cookie: bob.cookie })(`${base}/metadata`);
    expect(response.status).toBe(403);
    expect((response.json as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('seeds crm when a workspace is created and serves metadata with an ETag', async () => {
    const response = await api(`${base}/metadata`);
    expect(response.status).toBe(200);
    const schema = response.json as {
      version: number;
      objects: { nameSingular: string }[];
      modules: { id: string }[];
    };
    expect(schema.objects.map((o) => o.nameSingular).sort()).toEqual(['chore', 'company', 'deal', 'person']);
    expect(schema.modules.map((e) => e.id).sort()).toEqual(
      ['01a1751f-5f03-74c2-b95d-6e6e78e49bd4', crmIds.module].sort(),
    );
    const etag = response.headers.get('etag');
    expect(etag).toBe(`"${schema.version}"`);
    const cached = await api(`${base}/metadata`, { headers: { 'if-none-match': etag ?? '' } });
    expect(cached.status).toBe(304);
    const objects = await api(`${base}/metadata/objects`);
    expect((objects.json as unknown[]).length).toBe(4);
    const modules = await api(`${base}/modules`);
    expect(modules.json).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: crmIds.module, version: '0.1.0' })]),
    );
  });

  it('creates, queries, patches and deletes records with mapped errors', async () => {
    const company = await api(`${base}/records/company`, { body: { name: 'Globex', domain: 'globex.example' } });
    expect(company.status).toBe(201);
    const companyId = (company.json as { id: string }).id;
    const person = await api(`${base}/records/person`, {
      body: { first_name: 'Ada', email: 'Ada@Example.com', company: companyId },
    });
    expect(person.status).toBe(201);
    expect((person.json as { email: string }).email).toBe('ada@example.com');
    const personId = (person.json as { id: string }).id;

    const invalid = await api(`${base}/records/person`, { body: { first_name: 'x', nope: 1 } });
    expect(invalid.status).toBe(400);
    expect((invalid.json as { error: { code: string; details: unknown } }).error.code).toBe('VALIDATION');
    const duplicate = await api(`${base}/records/person`, { body: { first_name: 'Dup', email: 'ADA@example.com' } });
    expect(duplicate.status).toBe(409);
    expect((duplicate.json as { error: { code: string } }).error.code).toBe('UNIQUE_VIOLATION');
    const unknownObject = await api(`${base}/records/ghost`, { body: { a: 1 } });
    expect(unknownObject.status).toBe(404);
    const badQuery = await api(`${base}/records/person/list`, {
      body: { filter: { field: 'first_name', op: 'gt', value: 1 } },
    });
    expect(badQuery.status).toBe(400);
    const badBody = await api(`${base}/records/person/list`, { body: { limit: 'ten' } });
    expect(badBody.status).toBe(400);
    expect((badBody.json as { error: { code: string } }).error.code).toBe('VALIDATION');

    const query = await api(`${base}/records/person/list`, {
      body: {
        filter: { field: 'first_name', op: 'starts_with', value: 'ad' },
        include: { company: true },
        count: true,
      },
    });
    expect(query.status).toBe(200);
    const page = query.json as {
      items: { id: string }[];
      totalCount: number;
      included: { company: { name: string }[] };
      nextCursor: null;
    };
    expect(page.items.map((i) => i.id)).toEqual([personId]);
    expect(page.totalCount).toBe(1);
    expect(page.included.company[0]?.name).toBe('Globex');
    expect(page.nextCursor).toBeNull();

    const patched = await api(`${base}/records/person/${personId}`, { method: 'PATCH', body: { city: 'London' } });
    expect(patched.status).toBe(200);
    expect((patched.json as { city: string }).city).toBe('London');
    const fetched = await api(`${base}/records/person/${personId}`);
    expect((fetched.json as { city: string }).city).toBe('London');

    const batch = await api(`${base}/records/chore/batch`, {
      body: { create: [{ title: 'A' }, { title: 'B' }] },
    });
    expect(batch.status).toBe(200);
    const created = (batch.json as { created: { id: string }[] }).created;
    expect(created).toHaveLength(2);
    const bulkDelete = await api(`${base}/records/chore`, {
      method: 'DELETE',
      body: { ids: created.map((c) => c.id) },
    });
    expect(bulkDelete.status).toBe(204);

    const search = await api(`${base}/lookup`, { body: { text: 'glob' } });
    expect(search.status).toBe(200);
    expect(search.json).toEqual([expect.objectContaining({ object: 'company', title: 'Globex', subtitle: 'Company' })]);

    const deleted = await api(`${base}/records/person/${personId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(204);
    expect((await api(`${base}/records/person/${personId}`)).status).toBe(404);
  });

  it("serves a record's activity: what changed, and nothing else", async () => {
    const created = await api(`${base}/records/company`, { body: { name: 'Initech' } });
    const id = (created.json as { id: string }).id;
    await api(`${base}/records/company/${id}`, { method: 'PATCH', body: { employees: 12 } });
    // A comment is not activity: it has its own list.
    await api(`${base}/records/company/${id}/comments`, { body: { title: 'Met them at the expo' } });
    const page = await api(`${base}/records/company/${id}/activity?limit=10`);
    expect(page.status).toBe(200);
    const items = (page.json as { items: { kind: string; changes?: unknown[] }[] }).items;
    expect(items.map((item) => item.kind)).toEqual(['updated', 'created']);
    expect(items[0]?.changes).toEqual([{ field: 'employees', before: null, after: 12 }]);
    expect((await api(`${base}/records/company/${id}/activity?cursor=x`)).status).toBe(400);
  });

  it("keeps a record's comments: written, edited, listed newest first and removed", async () => {
    const created = await api(`${base}/records/company`, { body: { name: 'Hooli' } });
    const id = (created.json as { id: string }).id;
    const first = await api(`${base}/records/company/${id}/comments`, {
      body: { title: 'Gate code', body: '4512, ring twice' },
    });
    expect(first.status).toBe(201);
    const commentId = (first.json as { id: string }).id;
    await api(`${base}/records/company/${id}/comments`, { body: { title: 'Wants a heat pump' } });
    expect((await api(`${base}/records/company/${id}/comments`, { body: { title: '  ' } })).status).toBe(400);

    const page = await api(`${base}/records/company/${id}/comments?limit=10`);
    expect(page.status).toBe(200);
    const { items, total } = page.json as { items: { title: string; author: { kind: string } }[]; total: number };
    expect(items.map((item) => item.title)).toEqual(['Wants a heat pump', 'Gate code']);
    expect(total).toBe(2);
    expect(items[0]?.author.kind).toBe('user');

    const edited = await api(`${base}/records/company/${id}/comments/${commentId}`, {
      method: 'PATCH',
      body: { body: 'changed to 9921' },
    });
    expect(edited.status).toBe(200);
    expect(edited.json).toMatchObject({ title: 'Gate code', body: 'changed to 9921' });
    expect((await api(`${base}/records/company/${id}/comments?cursor=x`)).status).toBe(400);

    // Comments are not activity or records: the timeline stays as it was.
    const activity = await api(`${base}/records/company/${id}/activity`);
    expect((activity.json as { items: { kind: string }[] }).items.map((item) => item.kind)).toEqual(['created']);

    const removed = await api(`${base}/records/company/${id}/comments/${commentId}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    const after = await api(`${base}/records/company/${id}/comments`);
    expect((after.json as { total: number }).total).toBe(1);
  });

  it('manages workspace metadata over HTTP', async () => {
    const object = await api(`${base}/metadata/objects`, {
      body: { nameSingular: 'ticket', namePlural: 'tickets', labelSingular: 'Ticket', labelPlural: 'Tickets' },
    });
    expect(object.status).toBe(201);
    const objectId = (object.json as { id: string }).id;
    const field = await api(`${base}/metadata/fields`, {
      body: { objectId, name: 'title', type: 'text', label: 'Title', isRequired: true },
    });
    expect(field.status).toBe(201);
    const renamed = await api(`${base}/metadata/fields/${(field.json as { id: string }).id}`, {
      method: 'PATCH',
      body: { label: 'Subject' },
    });
    expect((renamed.json as { label: string }).label).toBe('Subject');
    // Partial view updates change only what they send: no defaults leak in for the type or the config keys.
    const view = await api(`${base}/metadata/views`, {
      body: {
        objectId,
        label: 'Cards',
        type: 'gallery',
        config: { fields: [{ fieldId: 'title' }], sorts: [{ fieldId: 'title', direction: 'desc' }] },
      },
    });
    expect(view.status).toBe(201);
    const viewUrl = `${base}/metadata/views/${(view.json as { id: string }).id}`;
    await api(viewUrl, { method: 'PATCH', body: { config: { filter: null, settings: { size: 'large' } } } });
    const saved = await api(viewUrl, { method: 'PATCH', body: { label: 'Board' } });
    expect(saved.json).toMatchObject({
      label: 'Board',
      type: 'gallery',
      config: {
        fields: [{ fieldId: expect.any(String), visible: true }],
        sorts: [{ fieldId: expect.any(String), direction: 'desc' }],
        settings: { size: 'large' },
      },
    });
    const plain = await api(`${base}/metadata/views`, { body: { objectId, label: 'All tickets' } });
    expect((plain.json as { type: string }).type).toBe('table');
    const bad = await api(`${base}/metadata/fields`, { body: { objectId, name: 'title', type: 'text', label: 'Dup' } });
    expect(bad.status).toBe(409);
    const record = await api(`${base}/records/ticket`, { body: { title: 'Printer on fire' } });
    expect(record.status).toBe(201);
    const removed = await api(`${base}/metadata/objects/${objectId}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    expect((await api(`${base}/metadata/objects/${objectId}`)).status).toBe(404);
  });

  it('streams the event backlog and live events over SSE', async () => {
    const note = await api(`${base}/records/chore`, { body: { title: 'Backlog note' } });
    expect(note.status).toBe(201);
    const controller = new AbortController();
    const response = await server.app.request(`${base}/events?after=0`, {
      headers: { cookie: alice.cookie },
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const current = await server.engine.events.currentSequence(ws.id);
    const frames = await readSse(response, current + 1);
    expect(frames[0]).toEqual({ event: 'ready', data: JSON.stringify({ sequence: current }) });
    const backlog = frames.slice(1);
    expect(backlog.map((f) => f.id)).toEqual(Array.from({ length: current }, (_, i) => String(i + 1)));
    expect(backlog[0]?.event).toBe('module.applied');
    const last = JSON.parse(backlog[backlog.length - 1]?.data ?? '{}') as {
      type: string;
      recordId: string;
      object: string;
    };
    expect(last).toEqual(
      expect.objectContaining({ type: 'record.created', object: 'chore', recordId: (note.json as { id: string }).id }),
    );

    const live = await api(`${base}/records/chore`, { body: { title: 'Live note' } });
    expect(live.status).toBe(201);
    const [frame] = await readSse(response, 1);
    expect(frame?.event).toBe('record.created');
    expect(frame?.id).toBe(String(current + 1));
    expect(JSON.parse(frame?.data ?? '{}')).toEqual(
      expect.objectContaining({ recordId: (live.json as { id: string }).id }),
    );
    controller.abort();
  });

  it('issues organization api keys and authenticates x-api-key requests with their permissions', async () => {
    const forbidden = await api(`${base}/api-keys`, { body: { name: 'reader' } });
    expect(forbidden.status).toBe(201);
    const reader = forbidden.json as { id: string; key: string; permissions: Record<string, string[]> };
    expect(reader.key).toMatch(/^devias_/);
    expect(reader.permissions).toEqual({ record: ['read'] });
    const list = await api(`${base}/api-keys`);
    expect((list.json as { id: string }[]).map((k) => k.id)).toEqual([reader.id]);
    expect(JSON.stringify(list.json)).not.toContain(reader.key);

    const viaKey = client(server, { apiKey: reader.key });
    const query = await viaKey(`${base}/records/company/list`, { body: {} });
    expect(query.status).toBe(200);
    expect((query.json as { items: unknown[] }).items.length).toBeGreaterThan(0);
    const write = await viaKey(`${base}/records/company`, { body: { name: 'Nope' } });
    expect(write.status).toBe(403);
    expect((await viaKey('/api/me')).status).toBe(401);
    expect((await client(server, { apiKey: 'devias_not_a_real_key' })(`${base}/metadata`)).status).toBe(401);

    const writer = await api(`${base}/api-keys`, {
      body: { name: 'writer', expiresInDays: 30, permissions: { record: ['read', 'write'], metadata: ['read'] } },
    });
    expect(writer.status).toBe(201);
    const writerKey = (writer.json as { key: string; expiresAt: string | null }).key;
    expect((writer.json as { expiresAt: string | null }).expiresAt).toBeTruthy();
    const created = await client(server, { apiKey: writerKey })(`${base}/records/company`, {
      body: { name: 'Via key' },
    });
    expect(created.status).toBe(201);
    expect((created.json as { created_by: string }).created_by).toMatch(/^api_key:/);
    expect(
      (
        await client(server, { apiKey: writerKey })(`${base}/modules/plan`, {
          body: { manifest: { id: 'demo', label: 'Demo', version: '1.0.0' } },
        })
      ).status,
    ).toBe(403);

    const other = await createWorkspace(api, 'Other', 'other');
    expect((await viaKey(`/api/workspaces/${other.id}/records/company/list`, { body: {} })).status).toBe(403);

    const revoked = await api(`${base}/api-keys/${reader.id}`, { method: 'DELETE' });
    expect(revoked.status).toBe(204);
    expect((await viaKey(`${base}/records/company/list`, { body: {} })).status).toBe(401);
  });

  it('restricts members from managing api keys and modules but lets them write records', async () => {
    const carol = await signUp(server, 'carol@example.com', 'Carol');
    await server.auth.api.addMember({ body: { userId: carol.userId, organizationId: ws.id, role: 'member' } });
    const member = client(server, { cookie: carol.cookie });
    expect((await member(`${base}/metadata`)).status).toBe(200);
    expect((await member(`${base}/records/company`, { body: { name: 'Member co' } })).status).toBe(201);
    expect((await member(`${base}/api-keys`, { body: { name: 'x' } })).status).toBe(403);
    expect(
      (await member(`${base}/modules/plan`, { body: { manifest: { id: 'demo', label: 'Demo', version: '1.0.0' } } }))
        .status,
    ).toBe(403);
    expect(
      (
        await member(`${base}/metadata/objects`, {
          body: { nameSingular: 'a', namePlural: 'b', labelSingular: 'A', labelPlural: 'B' },
        })
      ).status,
    ).toBe(403);
  });

  it('plans, applies and uninstalls modules over HTTP', async () => {
    const manifest = {
      id: '01a1751f-5f0f-73b8-8e84-4223da96e386',
      label: 'Scoring',
      version: '1.0.0',
      fields: [
        {
          id: '01a1751f-5f0e-7530-b194-da55300fcba2',
          objectId: crmIds.objects.person,
          name: 'score',
          label: 'Score',
          type: 'number',
        },
      ],
    };
    const plan = await api(`${base}/modules/plan`, { body: { manifest } });
    expect(plan.status).toBe(200);
    const planResult = plan.json as { planHash: string; changes: { action: string }[]; hasDestructive: boolean };
    expect(planResult.changes.map((c) => c.action)).toEqual(['create']);
    const mismatch = await api(`${base}/modules/apply`, { body: { manifest, expectedPlanHash: 'nope' } });
    expect(mismatch.status).toBe(409);
    expect((mismatch.json as { error: { code: string } }).error.code).toBe('PLAN_MISMATCH');
    const applied = await api(`${base}/modules/apply`, {
      body: { manifest, expectedPlanHash: planResult.planHash },
    });
    expect(applied.status).toBe(200);
    expect((applied.json as { applied: unknown[] }).applied).toHaveLength(1);
    const missing = await api(`${base}/modules/plan`, {
      body: {
        manifest: {
          id: '01a1751f-5f0f-73b8-8e84-3f002a154d9e',
          label: 'Other',
          version: '1.0.0',
          views: [
            {
              id: '01a17522-1eaf-7130-af61-d3785ab36abd',
              objectId: '01a1751f-5f0e-7530-b194-d508af8201bd',
              label: 'X',
            },
          ],
        },
      },
    });
    expect(missing.status).toBe(422);
    const blocked = await api(`${base}/modules/01a1751f-5f0f-73b8-8e84-4223da96e386`, { method: 'DELETE' });
    expect(blocked.status).toBe(409);
    expect((blocked.json as { error: { code: string } }).error.code).toBe('DESTRUCTIVE_CHANGE');
    const removed = await api(`${base}/modules/01a1751f-5f0f-73b8-8e84-4223da96e386?allowDestructive=true`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    expect((await api(`${base}/modules`)).json).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: crmIds.module })]),
    );
  });

  it('mounts module routes that run as the caller', async () => {
    const health = await api(`${base}/mod/${crmIds.module}/health`);
    expect(health.status).toBe(200);
    expect(health.json).toEqual({ ok: true, module: crmIds.module });
    expect((await client(server)(`${base}/mod/${crmIds.module}/health`)).status).toBe(401);
    const unknown = await api(`${base}/mod/nope/health`);
    expect(unknown.status).toBe(404);
  });

  it('runs record-event workflows: a stage change fires the steps once, as the workflow actor', async () => {
    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Customer kickoff',
        trigger: {
          kind: 'record_event',
          objectId: 'deal',
          types: ['record.updated'],
          fieldIds: ['stage'],
          condition: { field: 'stage', op: 'eq', value: 'customer' },
        },
        steps: [
          {
            id: 'close',
            name: 'Close it',
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'deal', id: '{{record.id}}', values: { probability: 100 } },
          },
          {
            id: 'chore',
            kind: 'action',
            actionId: coreIds.actions.create_record,
            input: {
              object: 'chore',
              values: {
                title: 'Kick off {{record.name}}',
                status: 'todo',
                due_date: '{{today}}',
              },
            },
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const workflow = created.json as { id: string; steps: { id: string }[]; enabled: boolean };
    expect(workflow.steps.map((s) => s.id)).toEqual(['close', 'chore']);

    const deal = await api(`${base}/records/deal`, { body: { name: 'Big fish', stage: 'proposal' } });
    const id = (deal.json as { id: string }).id;
    expect(await server.workflows.runOnce(ws.id)).toBe(0);
    await api(`${base}/records/deal/${id}`, { method: 'PATCH', body: { amount: 5 } });
    expect(await server.workflows.runOnce(ws.id)).toBe(0);
    await api(`${base}/records/deal/${id}`, { method: 'PATCH', body: { stage: 'customer' } });
    expect(await server.workflows.runOnce(ws.id)).toBe(1);
    expect(await server.workflows.runOnce(ws.id)).toBe(0);

    const updated = (await api(`${base}/records/deal/${id}`)).json as Record<string, unknown>;
    expect(updated).toMatchObject({ probability: 100, updated_by: `workflow:${workflow.id}` });
    const tasks = (
      (
        await api(`${base}/records/chore/list`, {
          body: { filter: { field: 'title', op: 'eq', value: 'Kick off Big fish' } },
        })
      ).json as { items: Record<string, unknown>[] }
    ).items;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: 'todo', created_by: `workflow:${workflow.id}` });
    expect(tasks[0]?.due_date).toBe(new Date().toISOString().slice(0, 10));

    const runs = (await api(`${base}/workflows/${workflow.id}/runs`)).json as {
      items: {
        status: string;
        trigger: Record<string, unknown>;
        steps: { id: string; status: string; output: Record<string, unknown> }[];
      }[];
    };
    expect(runs.items).toHaveLength(1);
    expect(runs.items[0]).toMatchObject({
      status: 'succeeded',
      trigger: { kind: 'record_event', objectId: crmIds.objects.deal, recordId: id, eventType: 'record.updated' },
    });
    expect(runs.items[0]?.steps.map((s) => [s.id, s.status])).toEqual([
      ['close', 'succeeded'],
      ['chore', 'succeeded'],
    ]);
    expect(runs.items[0]?.steps[1]).toMatchObject({
      actionId: coreIds.actions.create_record,
      output: { id: tasks[0]?.id },
    });

    // The workflow's own write does not start it again, and disabled workflows stay quiet.
    const listed = (await api(`${base}/workflows`)).json as { id: string; lastRunAt: string | null }[];
    expect(listed.find((w) => w.id === workflow.id)?.lastRunAt).not.toBeNull();
    await api(`${base}/workflows/${workflow.id}`, { method: 'PATCH', body: { enabled: false } });
    await api(`${base}/records/deal/${id}`, { method: 'PATCH', body: { stage: 'proposal' } });
    await api(`${base}/records/deal/${id}`, { method: 'PATCH', body: { stage: 'customer' } });
    expect(await server.workflows.runOnce(ws.id)).toBe(0);
    const removed = await api(`${base}/workflows/${workflow.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(204);
    expect((await api(`${base}/workflows/${workflow.id}/runs`)).status).toBe(404);
  });

  it('runs manual workflows on a record, records failures, and validates input', async () => {
    const bad = await api(`${base}/workflows`, {
      body: {
        title: 'Broken',
        trigger: { kind: 'manual', objectId: 'ghost' },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'ghost', id: '{{record.id}}', values: {} },
          },
        ],
      },
    });
    expect(bad.status).toBe(400);
    expect((bad.json as { error: { code: string } }).error.code).toBe('VALIDATION');

    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Mark as software',
        trigger: { kind: 'manual', objectId: 'company' },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'company', id: '{{record.id}}', values: { industry: 'software' } },
          },
          {
            kind: 'action',
            actionId: coreIds.actions.create_record,
            input: { object: 'chore', values: { title: 'Marked {{record.name}} as software' } },
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const workflowId = (created.json as { id: string }).id;
    const company = await api(`${base}/records/company`, { body: { name: 'Manual Inc' } });
    const companyId = (company.json as { id: string }).id;

    const missing = await api(`${base}/workflows/${workflowId}/run`, { body: {} });
    expect(missing.status).toBe(400);
    const run = await api(`${base}/workflows/${workflowId}/run`, { body: { recordId: companyId } });
    expect(run.status).toBe(201);
    expect(run.json).toMatchObject({
      status: 'succeeded',
      trigger: {
        kind: 'manual',
        objectId: crmIds.objects.company,
        recordId: companyId,
        actor: { kind: 'user', id: alice.userId },
      },
      steps: [
        { kind: 'action', actionId: coreIds.actions.update_record, status: 'succeeded' },
        {
          kind: 'action',
          actionId: coreIds.actions.create_record,
          status: 'succeeded',
          output: { id: expect.any(String) },
        },
      ],
    });
    expect(((await api(`${base}/records/company/${companyId}`)).json as { industry: string }).industry).toBe(
      'software',
    );

    // A step that violates the data model fails the run and stops it.
    await api(`${base}/workflows/${workflowId}`, {
      method: 'PATCH',
      body: {
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'company', id: '{{record.id}}', values: { employees: 'many' } },
          },
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'company', id: '{{record.id}}', values: { city: 'Oslo' } },
          },
        ],
      },
    });
    const failed = await api(`${base}/workflows/${workflowId}/run`, { body: { recordId: companyId } });
    expect(failed.status).toBe(201);
    expect(failed.json).toMatchObject({ status: 'failed', steps: [{ status: 'failed' }] });
    expect((failed.json as { error: string }).error).toMatch(/Step 1 .* failed/);
    expect((failed.json as { steps: unknown[] }).steps).toHaveLength(1);

    // Branches pick a lane from the record as it is when they are reached; only that lane's steps run.
    await api(`${base}/workflows/${workflowId}`, {
      method: 'PATCH',
      body: {
        steps: [
          {
            id: 'grow',
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'company', id: '{{record.id}}', values: { employees: 250 } },
          },
          {
            id: 'size',
            kind: 'branch',
            condition: { field: 'employees', op: 'gte', value: 100 },
            yes: [
              {
                id: 'big',
                kind: 'action',
                actionId: coreIds.actions.update_record,
                input: { object: 'company', id: '{{record.id}}', values: { city: 'Big {{record.name}}' } },
              },
            ],
            no: [
              {
                id: 'small',
                kind: 'action',
                actionId: coreIds.actions.update_record,
                input: { object: 'company', id: '{{record.id}}', values: { city: 'Small' } },
              },
            ],
          },
        ],
      },
    });
    const branched = await api(`${base}/workflows/${workflowId}/run`, { body: { recordId: companyId } });
    expect(branched.status).toBe(201);
    expect((branched.json as { steps: { id: string; status: string; output?: unknown }[] }).steps).toEqual([
      expect.objectContaining({ id: 'grow', status: 'succeeded' }),
      expect.objectContaining({ id: 'size', status: 'succeeded', output: { matched: true, branch: 'yes' } }),
      expect.objectContaining({ id: 'big', status: 'succeeded' }),
    ]);
    expect(((await api(`${base}/records/company/${companyId}`)).json as { city: string }).city).toBe('Big Manual Inc');

    await api(`${base}/workflows/${workflowId}`, { method: 'PATCH', body: { enabled: false } });
    expect((await api(`${base}/workflows/${workflowId}/run`, { body: { recordId: companyId } })).status).toBe(409);

    // Api keys need the workflow grants; the default map has none.
    const key = await api(`${base}/api-keys`, { body: { name: 'wf', permissions: { record: ['read'] } } });
    const keyed = client(server, { apiKey: (key.json as { key: string }).key });
    expect((await keyed(`${base}/workflows`)).status).toBe(403);
  });

  it('ticks scheduled workflows once they are due, once per matching record', async () => {
    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Close stale tasks',
        trigger: {
          kind: 'schedule',
          cron: '0 * * * *',
          objectId: 'chore',
          condition: { field: 'title', op: 'starts_with', value: 'Stale' },
        },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'chore', id: '{{record.id}}', values: { status: 'done' } },
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const workflow = created.json as { id: string; nextRunAt: string };
    expect(Date.parse(workflow.nextRunAt)).toBeGreaterThan(Date.now());
    await api(`${base}/records/chore/batch`, {
      body: { create: [{ title: 'Stale one' }, { title: 'Stale two' }, { title: 'Fresh' }] },
    });
    expect(await server.workflows.runOnce(ws.id)).toBe(0);
    await server.engine.workflows.enqueueRuns(ws.id, workflow.id, [], { nextRunAt: new Date(0) });
    expect(await server.workflows.runOnce(ws.id)).toBe(2);
    const tasks = (
      (
        await api(`${base}/records/chore/list`, {
          body: { filter: { field: 'title', op: 'in', value: ['Stale one', 'Stale two', 'Fresh'] } },
        })
      ).json as { items: { title: string; status: string }[] }
    ).items;
    expect(Object.fromEntries(tasks.map((t) => [t.title, t.status]))).toEqual({
      'Stale one': 'done',
      'Stale two': 'done',
      Fresh: 'todo',
    });
    const after = (await api(`${base}/workflows/${workflow.id}`)).json as { nextRunAt: string };
    // Booked for the next top of the hour, not an hour from the tick.
    const next = Date.parse(after.nextRunAt);
    expect(next % 3_600_000).toBe(0);
    expect(next).toBeGreaterThan(Date.now());
    expect(next).toBeLessThanOrEqual(Date.now() + 3_600_000);
    expect(await server.workflows.runOnce(ws.id)).toBe(0);
    const runs = (await api(`${base}/workflows/${workflow.id}/runs`)).json as {
      items: { trigger: { kind: string } }[];
    };
    expect(runs.items.map((r) => r.trigger.kind)).toEqual(['schedule', 'schedule']);
  });

  it('sends notifications to roles, everyone, people and oneself; each person sees and keeps only their own', async () => {
    const member = client(server, { cookie: erin.cookie });
    const memberCount = ((await api(`${base}/members`)).json as unknown[]).length;
    const titlesOf = (page: unknown) => (page as { items: { title: string }[] }).items.map((item) => item.title);

    const toOwners = await api(`${base}/notifications`, { body: { title: 'Owners only', to: { roles: ['owner'] } } });
    expect(toOwners.status).toBe(201);
    expect(toOwners.json).toEqual({ recipients: 1, created: 1, updated: 0 });
    const toAll = await api(`${base}/notifications`, {
      body: {
        title: 'Everyone',
        body: 'Hello **all**',
        level: 'warning',
        kind: 'ops.announcement',
        target: { kind: 'object', object: 'company' },
        to: { all: true },
      },
    });
    expect(toAll.json).toEqual({ recipients: memberCount, created: memberCount, updated: 0 });
    // Members send too, by user id or to themselves.
    expect(
      (await member(`${base}/notifications`, { body: { title: 'For Alice', to: { users: [alice.userId] } } })).json,
    ).toEqual({ recipients: 1, created: 1, updated: 0 });
    expect((await member(`${base}/notifications`, { body: { title: 'Note to self', to: { me: true } } })).status).toBe(
      201,
    );
    const unknown = await api(`${base}/notifications`, { body: { title: 'Lost', to: { users: ['nobody'] } } });
    expect(unknown.status).toBe(400);
    expect((unknown.json as { error: { message: string } }).error.message).toContain('nobody');
    expect((await api(`${base}/notifications`, { body: { title: 'Nobody', to: {} } })).status).toBe(400);
    expect((await api(`${base}/notifications`, { body: { title: '', to: { all: true } } })).status).toBe(400);

    const mine = await member(`${base}/notifications`);
    expect(mine.status).toBe(200);
    expect(titlesOf(mine.json)).toEqual(['Note to self', 'Everyone']);
    const items = (mine.json as { items: { id: string; recipientId: string; actor: unknown; readAt: null }[] }).items;
    expect(items.every((item) => item.recipientId === erin.userId)).toBe(true);
    expect(items[1]).toMatchObject({
      title: 'Everyone',
      body: 'Hello **all**',
      level: 'warning',
      kind: 'ops.announcement',
      target: { kind: 'object', object: 'company' },
      actor: { kind: 'user', id: alice.userId },
      readAt: null,
    });
    expect(titlesOf((await api(`${base}/notifications?unread=true&limit=10`)).json)).toEqual([
      'For Alice',
      'Everyone',
      'Owners only',
    ]);
    expect((await member(`${base}/notifications/unread-count`)).json).toEqual({ count: 2 });
    expect((await member(`${base}/notifications?cursor=nope`)).status).toBe(400);

    const self = items[0]?.id ?? '';
    const read = await member(`${base}/notifications/${self}/read`, { method: 'POST' });
    expect(read.status).toBe(200);
    expect((read.json as { readAt: string | null }).readAt).not.toBeNull();
    expect((await member(`${base}/notifications/unread-count`)).json).toEqual({ count: 1 });
    const unread = await member(`${base}/notifications/${self}/unread`, { method: 'POST' });
    expect((unread.json as { readAt: string | null }).readAt).toBeNull();
    // Another person's row is as good as missing.
    expect((await api(`${base}/notifications/${self}/read`, { method: 'POST' })).status).toBe(404);
    expect((await api(`${base}/notifications/${self}`, { method: 'DELETE' })).status).toBe(404);
    expect((await member(`${base}/notifications/read-all`, { method: 'POST' })).json).toEqual({ updated: 2 });
    expect((await member(`${base}/notifications/unread-count`)).json).toEqual({ count: 0 });
    expect((await member(`${base}/notifications/${self}`, { method: 'DELETE' })).status).toBe(204);
    expect(titlesOf((await member(`${base}/notifications`)).json)).toEqual(['Everyone']);

    // A repeated key replaces the unread notification instead of adding one.
    const running = { title: 'Import running', key: 'import', to: { me: true } };
    expect((await api(`${base}/notifications`, { body: running })).json).toEqual({
      recipients: 1,
      created: 1,
      updated: 0,
    });
    expect(
      (await api(`${base}/notifications`, { body: { ...running, title: 'Import done', level: 'success' } })).json,
    ).toEqual({ recipients: 1, created: 0, updated: 1 });
    const imports = (
      (await api(`${base}/notifications`)).json as { items: { key: string | null; title: string }[] }
    ).items.filter((item) => item.key === 'import');
    expect(imports.map((item) => item.title)).toEqual(['Import done']);

    // Api keys send with the grant and never read: they are not people.
    const granted = await api(`${base}/api-keys`, {
      body: { name: 'notifier', permissions: { notification: ['send'] } },
    });
    const viaKey = client(server, { apiKey: (granted.json as { key: string }).key });
    const sent = await viaKey(`${base}/notifications`, { body: { title: 'From a key', to: { roles: ['owner'] } } });
    expect(sent.status).toBe(201);
    expect((await viaKey(`${base}/notifications`)).status).toBe(403);
    expect((await viaKey(`${base}/notifications/unread-count`)).status).toBe(403);
    expect((await viaKey(`${base}/notifications`, { body: { title: 'Me?', to: { me: true } } })).status).toBe(400);
    const reader = await api(`${base}/api-keys`, { body: { name: 'reader-only' } });
    const readerKey = client(server, { apiKey: (reader.json as { key: string }).key });
    expect((await readerKey(`${base}/notifications`, { body: { title: 'No', to: { all: true } } })).status).toBe(403);
    const fromKey = ((await api(`${base}/notifications?limit=1`)).json as { items: { actor: unknown }[] }).items[0];
    expect(fromKey).toMatchObject({ title: 'From a key', actor: { kind: 'api_key' } });
  });

  it('notifies from a workflow step as the workflow', async () => {
    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Flag a task',
        trigger: { kind: 'manual', objectId: 'chore' },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.send_notification,
            input: {
              title: 'Look at {{record.title}}',
              kind: 'crm.task_flagged',
              target: { kind: 'record', object: 'chore', id: '{{record.id}}' },
              to: { roles: ['owner'] },
            },
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const task = (await api(`${base}/records/chore`, { body: { title: 'Call Globex' } })).json as { id: string };
    const run = await api(`${base}/workflows/${(created.json as { id: string }).id}/run`, {
      body: { recordId: task.id },
    });
    expect(run.status).toBe(201);
    expect(run.json).toMatchObject({
      status: 'succeeded',
      steps: [
        { actionId: coreIds.actions.send_notification, status: 'succeeded', output: { recipients: 1, created: 1 } },
      ],
    });
    const latest = ((await api(`${base}/notifications?limit=1`)).json as { items: unknown[] }).items[0];
    expect(latest).toMatchObject({
      title: 'Look at Call Globex',
      kind: 'crm.task_flagged',
      target: { kind: 'record', object: 'chore', id: task.id },
      actor: { kind: 'workflow', id: (created.json as { id: string }).id },
    });
    // A step to oneself has nobody to mean by "me".
    const selfish = await api(`${base}/workflows`, {
      body: {
        title: 'Tell me',
        trigger: { kind: 'manual', objectId: 'chore' },
        steps: [
          { kind: 'action', actionId: coreIds.actions.send_notification, input: { title: 'Me', to: { me: true } } },
        ],
      },
    });
    const failed = await api(`${base}/workflows/${(selfish.json as { id: string }).id}/run`, {
      body: { recordId: task.id },
    });
    expect(failed.json).toMatchObject({ status: 'failed', error: expect.stringContaining('signed-in person') });
  });

  it('imports rows of a file over HTTP: checks them, writes the valid ones, and reports the rest by row', async () => {
    const rows = [
      ['Import One', '5'],
      ['Import Two', 'lots'],
      ['Import Three', '7'],
    ];
    const dry = await api(`${base}/records/company/import`, {
      body: { columns: ['name', 'employees'], rows, dryRun: true },
    });
    expect(dry.status).toBe(200);
    expect(dry.json).toMatchObject({ created: 2, skipped: 1, dryRun: true });
    const done = await api(`${base}/records/company/import`, { body: { columns: ['name', 'employees'], rows } });
    expect(done.json).toMatchObject({
      created: 2,
      skipped: 1,
      errors: [{ row: 3, field: 'Employees', message: '"lots" is not a number' }],
    });
    const listed = (
      await api(`${base}/records/company/list`, {
        body: { filter: { field: 'name', op: 'starts_with', value: 'Import' } },
      })
    ).json as { items: { name: string }[] };
    expect(listed.items.map((item) => item.name).sort()).toEqual(['Import One', 'Import Three']);
    expect((await api(`${base}/records/company/import`, { body: { columns: ['nope'], rows: [['x']] } })).status).toBe(
      400,
    );
    expect(
      (
        await client(server, { cookie: erin.cookie })(`${base}/records/company/import`, {
          body: { columns: ['name'], rows: [['Member Co']] },
        })
      ).status,
    ).toBe(200);
  });

  it('does not start record-event workflows for imported records, unless a workflow asks to', async () => {
    const make = async (title: string, onImport: boolean) => {
      const created = await api(`${base}/workflows`, {
        body: {
          title,
          trigger: {
            kind: 'record_event',
            objectId: 'chore',
            types: ['record.created'],
            ...(onImport ? { onImport } : {}),
          },
          steps: [
            {
              kind: 'action',
              actionId: coreIds.actions.update_record,
              input: { object: 'chore', id: '{{record.id}}', values: { status: 'todo' } },
            },
          ],
        },
      });
      expect(created.status).toBe(201);

      return (created.json as { id: string }).id;
    };
    const runsOf = async (id: string) =>
      ((await api(`${base}/workflows/${id}/runs`)).json as { items: unknown[] }).items.length;
    const ignoring = await make('Ignores imports', false);
    const asking = await make('Wants imports', true);
    await server.workflows.runOnce(ws.id);

    const imported = await api(`${base}/records/chore/import`, {
      body: { columns: ['title'], rows: [['Imported one'], ['Imported two']] },
    });
    expect(imported.json).toMatchObject({ created: 2 });
    await server.workflows.runOnce(ws.id);
    expect(await runsOf(ignoring)).toBe(0);
    expect(await runsOf(asking)).toBe(2);

    // A record a person makes still starts both.
    await api(`${base}/records/chore`, { body: { title: 'By hand' } });
    await server.workflows.runOnce(ws.id);
    expect(await runsOf(ignoring)).toBe(1);
    expect(await runsOf(asking)).toBe(3);
  });

  it('lets a workflow write and render rich text as Markdown, and keeps a document exactly when it copies one', async () => {
    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Write up',
        trigger: { kind: 'manual', objectId: 'chore' },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: {
              object: 'chore',
              id: '{{record.id}}',
              values: { description: 'Called **{{record.title}}**\n\n- [site](javascript:alert(1))' },
            },
          },
          // The whole expression is a document, and a notification's body takes text.
          {
            kind: 'action',
            actionId: coreIds.actions.send_notification,
            input: { title: 'Write-up of {{record.title}}', body: '{{record.description}}', to: { roles: ['owner'] } },
          },
          // Copying a document between rich-text fields keeps it as it is.
          {
            kind: 'action',
            actionId: coreIds.actions.create_record,
            input: { object: 'chore', values: { title: 'Copy', description: '{{record.description}}' } },
          },
          // And inside a longer sentence it reads as Markdown, never as JSON.
          {
            kind: 'action',
            actionId: coreIds.actions.send_notification,
            input: { title: 'Said: {{record.description}}', to: { roles: ['owner'] } },
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const chore = (await api(`${base}/records/chore`, { body: { title: 'Call Globex' } })).json as { id: string };
    const run = await api(`${base}/workflows/${(created.json as { id: string }).id}/run`, {
      body: { recordId: chore.id },
    });
    expect(run.json).toMatchObject({ status: 'succeeded' });

    const stored = (await api(`${base}/records/chore/${chore.id}`)).json as { description: { type: string } };
    expect(stored.description.type).toBe('doc');
    // The unsafe link lost its link and kept its text.
    expect(JSON.stringify(stored.description)).not.toContain('javascript');
    expect(JSON.stringify(stored.description)).toContain('site');

    const inbox = (await api(`${base}/notifications?limit=2`)).json as { items: { title: string; body?: string }[] };
    const [said, wrote] = inbox.items;
    expect(wrote?.title).toBe('Write-up of Call Globex');
    expect(wrote?.body).toContain('Called **Call Globex**');
    expect(wrote?.body).not.toContain('"type"');
    expect(said?.title).toContain('Said: Called **Call Globex**');
    expect(said?.title).not.toContain('"type"');

    const copied = (
      (await api(`${base}/records/chore/list`, { body: { filter: { field: 'title', op: 'eq', value: 'Copy' } } }))
        .json as { items: { description: unknown }[] }
    ).items[0];
    expect(copied?.description).toEqual(stored.description);
  });

  it('names a workflow step by its label in the run and in a failure, and ignores an old name', async () => {
    const created = await api(`${base}/workflows`, {
      body: {
        title: 'Labelled',
        trigger: { kind: 'manual', objectId: 'chore' },
        steps: [
          {
            kind: 'action',
            label: 'Say hello',
            name: 'old word',
            actionId: coreIds.actions.send_notification,
            input: { title: 'Hello', to: { roles: ['owner'] } },
          },
          {
            kind: 'action',
            label: 'Break',
            actionId: coreIds.actions.update_record,
            input: { object: 'chore', id: '00000000-0000-4000-8000-000000000000', values: { title: 'x' } },
          },
        ],
      },
    });
    expect(created.status).toBe(201);
    const steps = (created.json as { steps: Record<string, unknown>[] }).steps;
    expect(steps[0]).toMatchObject({ label: 'Say hello' });
    expect(steps[0]).not.toHaveProperty('name');
    const chore = (await api(`${base}/records/chore`, { body: { title: 'Run on me' } })).json as { id: string };
    const run = await api(`${base}/workflows/${(created.json as { id: string }).id}/run`, {
      body: { recordId: chore.id },
    });
    expect(run.json).toMatchObject({
      status: 'failed',
      steps: [
        { label: 'Say hello', status: 'succeeded' },
        { label: 'Break', status: 'failed' },
      ],
      error: expect.stringContaining('Step 2 (Break) failed'),
    });
  });

  it('keeps notification events to their recipient on the SSE stream while record events still flow', async () => {
    const current = await server.engine.events.currentSequence(ws.id);
    const controller = new AbortController();
    const response = await server.app.request(`${base}/events?after=${current}`, {
      headers: { cookie: erin.cookie },
      signal: controller.signal,
    });
    expect((await readSse(response, 1))[0]?.event).toBe('ready');

    // The owner notifies only themself, then creates a record: the member's stream skips the first.
    await api(`${base}/notifications`, { body: { title: 'Private', to: { me: true } } });
    const note = await api(`${base}/records/chore`, { body: { title: 'Public note' } });
    const [frame] = await readSse(response, 1);
    expect(frame?.event).toBe('record.created');
    expect(frame?.id).toBe(String(current + 2));
    expect(JSON.parse(frame?.data ?? '{}')).toMatchObject({ recordId: (note.json as { id: string }).id });

    // Their own do arrive.
    await api(`${base}/notifications`, { body: { title: 'For Erin', to: { users: [erin.userId] } } });
    const [own] = await readSse(response, 1);
    expect(own?.event).toBe('notification.changed');
    expect(own?.id).toBe(String(current + 3));
    expect(JSON.parse(own?.data ?? '{}')).toMatchObject({
      type: 'notification.changed',
      recipientId: erin.userId,
      action: 'created',
      notificationId: expect.any(String),
    });
    controller.abort();
  });
});

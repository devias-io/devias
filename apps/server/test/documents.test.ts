import type { Document, DocumentPage } from '@devias/core';
import { readEventsAfter } from '@devias/data-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { type Api, client, createTestServer, createWorkspace, signUp } from './helpers';

describe('documents API', () => {
  let server: Server;
  let api: Api;
  let base: string;
  let workspaceId: string;

  beforeAll(async () => {
    server = await createTestServer();
    const alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    const workspace = await createWorkspace(api, 'Acme', 'acme');
    workspaceId = workspace.id;
    base = `/api/workspaces/${workspace.id}`;
  });
  afterAll(() => server.close());

  it('creates, reads, changes, adds to and removes a document', async () => {
    const created = await api(`${base}/documents`, { body: { title: 'Plan', markdown: '# Goals\n\nShip it.' } });
    expect(created.status).toBe(201);
    const doc = created.json as Document;
    expect(doc).toMatchObject({ title: 'Plan', version: 1, markdown: '# Goals\n\nShip it.' });
    expect(doc.body.type).toBe('doc');

    expect(((await api(`${base}/documents/${doc.id}`)).json as Document).id).toBe(doc.id);

    const renamed = await api(`${base}/documents/${doc.id}`, { method: 'PATCH', body: { title: 'Roadmap' } });
    expect(renamed.status).toBe(200);
    expect(renamed.json).toMatchObject({ title: 'Roadmap', version: 2 });

    const appended = await api(`${base}/documents/${doc.id}/append`, { body: { markdown: 'More.' } });
    expect(appended.status).toBe(200);
    expect(appended.json).toMatchObject({ version: 3, markdown: '# Goals\n\nShip it.\n\nMore.' });

    const stale = await api(`${base}/documents/${doc.id}`, {
      method: 'PATCH',
      body: { markdown: 'x', expectedVersion: 1 },
    });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: { code: 'CONFLICT' } });

    const page = (await api(`${base}/documents?search=roadmap`)).json as DocumentPage;
    expect(page.items.map((item) => item.title)).toEqual(['Roadmap']);
    expect(page.items[0]).not.toHaveProperty('body');
    expect(page.total).toBe(1);

    expect((await api(`${base}/documents/${doc.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await api(`${base}/documents/${doc.id}`)).status).toBe(404);
  });

  it('keeps a timeline and takes comments', async () => {
    const doc = (await api(`${base}/documents`, { body: { title: 'Brief' } })).json as Document;
    const comment = await api(`${base}/documents/${doc.id}/comments`, { body: { markdown: 'Check **this**' } });
    expect(comment.status).toBe(201);
    expect(comment.json).toMatchObject({ body: 'Check **this**', documentId: doc.id, anchor: null });
    expect((await api(`${base}/documents/${doc.id}/comments`, { body: { markdown: ' ' } })).status).toBe(400);
    const timeline = (await api(`${base}/documents/${doc.id}/activity`)).json as { items: { kind: string }[] };
    expect(timeline.items.map((entry) => entry.kind)).toEqual(['comment', 'created']);
    expect((await api(`${base}/documents/${doc.id}/activity?cursor=junk`)).status).toBe(400);
    expect((await api(`${base}/documents/00000000-0000-4000-8000-000000000009/activity`)).status).toBe(404);
  });

  it('takes comments on a selection, replies, resolving and deleting', async () => {
    const doc = (await api(`${base}/documents`, { body: { title: 'Offer', markdown: 'The price list is attached.' } }))
      .json as Document;
    const first = await api(`${base}/documents/${doc.id}/comments`, {
      body: { markdown: 'Current?', anchor: { quote: 'price list' } },
    });
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ anchor: { quote: 'price list', prefix: 'The ', hint: 4 }, parentId: null });
    const id = (first.json as { id: string }).id;
    expect(
      (await api(`${base}/documents/${doc.id}/comments`, { body: { markdown: 'x', anchor: { quote: 'nope' } } }))
        .status,
    ).toBe(400);
    const reply = await api(`${base}/documents/${doc.id}/comments`, { body: { markdown: 'Yes.', parent: id } });
    expect(reply.status).toBe(201);
    const threads = (await api(`${base}/documents/${doc.id}/comments`)).json as { items: { replies: unknown[] }[] };
    expect(threads.items.map((thread) => thread.replies.length)).toEqual([1]);
    const resolved = await api(`${base}/documents/${doc.id}/comments/${id}`, {
      method: 'PATCH',
      body: { resolved: true },
    });
    expect(resolved.status).toBe(200);
    expect(((await api(`${base}/documents/${doc.id}/comments`)).json as { items: unknown[] }).items).toHaveLength(0);
    expect(
      ((await api(`${base}/documents/${doc.id}/comments?status=resolved`)).json as { items: unknown[] }).items,
    ).toHaveLength(1);
    expect((await api(`${base}/documents/${doc.id}/comments/${id}`, { method: 'PATCH', body: {} })).status).toBe(400);
    expect((await api(`${base}/documents/${doc.id}/comments/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect(
      ((await api(`${base}/documents/${doc.id}/comments?status=all`)).json as { items: unknown[] }).items,
    ).toHaveLength(0);
    expect((await api(`${base}/documents/${doc.id}/comments/${id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('refuses what is not a document', async () => {
    expect((await api(`${base}/documents`, { body: {} })).status).toBe(400);
    expect(
      (await api(`${base}/documents`, { body: { title: 'x', markdown: 'y', body: { type: 'doc' } } })).status,
    ).toBe(400);
    expect((await api(`${base}/documents/not-a-uuid`)).status).toBe(400);
    expect((await api(`${base}/documents?limit=1000`)).status).toBe(400);
    expect((await api(`${base}/documents?mentions=nonsense`)).status).toBe(400);
    expect((await client(server)(`${base}/documents`)).status).toBe(401);
  });

  it('lists the documents that mention a record, by link', async () => {
    const company = (await api(`${base}/records/company`, { body: { name: 'Initech' } })).json as { id: string };
    const doc = (
      await api(`${base}/documents`, {
        body: { title: 'Visit', markdown: `Met [Initech](record:company/${company.id}).` },
      })
    ).json as Document;
    const found = (await api(`${base}/documents?mentions=${encodeURIComponent(`record:company/${company.id}`)}`))
      .json as DocumentPage;
    expect(found.items.map((item) => item.id)).toEqual([doc.id]);
    const byIds = (await api(`${base}/documents?ids=${doc.id}`)).json as DocumentPage;
    expect(byIds.items).toHaveLength(1);
  });

  it('runs as a workflow step, with templates in the title and the text', async () => {
    const company = (await api(`${base}/records/company`, { body: { name: 'Globex' } })).json as { id: string };
    const workflow = (
      await api(`${base}/workflows`, {
        body: {
          title: 'Write up a visit',
          trigger: { kind: 'manual', objectId: 'company' },
          steps: [
            {
              kind: 'action',
              actionId: 'core.create_document',
              input: {
                title: 'Visit to {{record.name}}',
                markdown: 'Met [{{record.name}}](record:company/{{record.id}}).',
              },
            },
          ],
        },
      })
    ).json as { id: string };
    const run = await api(`${base}/workflows/${workflow.id}/run`, { body: { recordId: company.id } });
    expect(run.json).toMatchObject({ status: 'succeeded' });
    const found = (await api(`${base}/documents?mentions=${encodeURIComponent(`record:company/${company.id}`)}`))
      .json as DocumentPage;
    expect(found.items.map((item) => item.title)).toContain('Visit to Globex');
    const made = found.items.find((item) => item.title === 'Visit to Globex');
    expect(made?.createdBy).toEqual({ kind: 'workflow', id: workflow.id });
  });

  it('follows api key grants: documents need their own', async () => {
    const keyOf = async (permissions?: Record<string, string[]>) => {
      const response = await api(`${base}/api-keys`, { body: { name: 'k', ...(permissions ? { permissions } : {}) } });

      return client(server, { apiKey: (response.json as { key: string }).key });
    };
    const reader = await keyOf();
    expect((await reader(`${base}/documents`)).status).toBe(403);
    const documentReader = await keyOf({ document: ['read'] });
    expect((await documentReader(`${base}/documents`)).status).toBe(200);
    expect((await documentReader(`${base}/documents`, { body: { title: 'No' } })).status).toBe(403);
    const writer = await keyOf({ document: ['*'] });
    const made = await writer(`${base}/documents`, { body: { title: 'From a key' } });
    expect(made.status).toBe(201);
    expect((made.json as Document).createdBy).toMatchObject({ kind: 'api_key' });
  });

  it('tells the change feed and answers members', async () => {
    const before = await readEventsAfter(server.db.db, workspaceId, 0, 1000);
    const doc = (await api(`${base}/documents`, { body: { title: 'Feed' } })).json as Document;
    await api(`${base}/documents/${doc.id}`, { method: 'DELETE' });
    const events = (await readEventsAfter(server.db.db, workspaceId, 0, 1000)).slice(before.length);
    expect(events.map((event) => [event.type, 'action' in event ? event.action : null])).toEqual([
      ['document.changed', 'created'],
      ['document.changed', 'deleted'],
    ]);
  });
});

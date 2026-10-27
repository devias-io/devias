import { CORE_OWNER, coreIds } from '@devias/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '../src/boot';
import { type Api, client, createTestServer, createWorkspace, signUp } from './helpers';

describe('reading an object and a record with what belongs to them', () => {
  let server: Server;
  let api: Api;
  let base: string;

  beforeAll(async () => {
    server = await createTestServer();
    const alice = await signUp(server, 'alice@example.com', 'Alice');
    api = client(server, { cookie: alice.cookie });
    const ws = await createWorkspace(api, 'Acme', 'acme');
    base = `/api/workspaces/${ws.id}`;
  });
  afterAll(() => server.close());

  it('describes an object by API name or id with its fields and views, and refuses an unknown one', async () => {
    const made = await api(`${base}/metadata/objects`, {
      body: { nameSingular: 'widget', namePlural: 'widgets', labelSingular: 'Widget', labelPlural: 'Widgets' },
    });
    const object = made.json as { id: string };
    await api(`${base}/metadata/fields`, {
      body: { objectId: object.id, name: 'title', label: 'Title', type: 'text' },
    });

    const byName = await api(`${base}/metadata/objects/widget/describe`);
    expect(byName.status).toBe(200);
    const body = byName.json as { object: { id: string }; fields: { name: string }[]; views: unknown[] };
    expect(body.object.id).toBe(object.id);
    expect(body.fields.map((field) => field.name)).toContain('title');
    expect(((await api(`${base}/metadata/objects/${object.id}/describe`)).json as typeof body).object.id).toBe(
      object.id,
    );
    expect((await api(`${base}/metadata/objects/nope/describe`)).status).toBe(404);
  });

  it('reads a record with the records its relations point at, and 404s a missing one', async () => {
    const record = await api(`${base}/records/widget`, { body: { title: 'First' } });
    const id = (record.json as { id: string }).id;
    const read = await api(`${base}/records/widget/${id}/labels`);
    expect(read.status).toBe(200);
    expect((read.json as { record: { id: string; title: string } }).record).toMatchObject({ id, title: 'First' });
    expect((await api(`${base}/records/widget/00000000-0000-0000-0000-000000000009/labels`)).status).toBe(404);
    expect((await api(`${base}/records/nope/${id}/labels`)).status).toBe(404);
  });

  it('makes an object with its fields, its table and its sidebar row in one request', async () => {
    const made = await api(`${base}/metadata/objects`, {
      body: {
        nameSingular: 'gizmo',
        namePlural: 'gizmos',
        labelSingular: 'Gizmo',
        labelPlural: 'Gizmos',
        fields: [
          { name: 'name', type: 'text', label: 'Name' },
          {
            name: 'twin',
            type: 'relation',
            label: 'Twin',
            settings: { relationType: 'many_to_one', targetObjectId: 'gizmo' },
          },
        ],
      },
    });
    expect(made.status).toBe(201);
    const object = made.json as { id: string; primaryFieldId: string | null };
    const described = (await api(`${base}/metadata/objects/gizmo/describe`)).json as {
      fields: { id: string; name: string }[];
      views: { isDefault: boolean; config: { fields: { fieldId: string }[] } }[];
    };
    expect(described.fields.map((field) => field.name)).toEqual(['name', 'twin']);
    expect(object.primaryFieldId).toBe(described.fields[0]?.id);
    expect(described.views).toHaveLength(1);
    expect(described.views[0]?.config.fields.map((one) => one.fieldId)).toEqual(
      described.fields.map((field) => field.id),
    );
    const nav = (await api(`${base}/metadata/nav-items`)).json as { label: string; target: { objectId?: string } }[];
    expect(nav.filter((row) => row.target.objectId === object.id).map((row) => row.label)).toEqual(['Gizmos']);

    // A field refused halfway leaves no object, table or row behind.
    const refused = await api(`${base}/metadata/objects`, {
      body: {
        nameSingular: 'half',
        namePlural: 'halves',
        labelSingular: 'Half',
        labelPlural: 'Halves',
        fields: [
          { name: 'a', type: 'text', label: 'A' },
          { name: 'a', type: 'text', label: 'A again' },
        ],
      },
    });
    expect(refused.status).toBe(409);
    expect((await api(`${base}/metadata/objects/half/describe`)).status).toBe(404);
  });

  it('lists the blocks a layout can place, by surface', async () => {
    const records = (await api(`${base}/metadata/blocks`)).json as { blocks: { id: string; module: string }[] };
    expect(records.blocks.map((block) => block.id)).toEqual(
      expect.arrayContaining([coreIds.blocks.fields, coreIds.blocks.activity]),
    );
    expect(records.blocks.find((block) => block.id === coreIds.blocks.fields)?.module).toBe(CORE_OWNER);
    const home = (await api(`${base}/metadata/blocks?surface=home`)).json as { blocks: { id: string }[] };
    expect(home.blocks.map((block) => block.id)).toContain(coreIds.blocks.getting_started);
    expect(home.blocks.map((block) => block.id)).not.toContain(coreIds.blocks.fields);
    expect((await api(`${base}/metadata/blocks?surface=nope`)).status).toBe(400);
  });
});

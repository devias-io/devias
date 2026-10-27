import { coreIds, hashManifest, indexSchema, type WorkspaceEvent } from '@devias/core';
import { manifest as fixture, ids, OPPORTUNITY_STAGES } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError, q } from '../src';
import { createMockClient, type MockClient } from '../src/mock';
import { demoClient, seedDemo } from './demo-data';

const TODAY = '2026-09-21';
const OBJECTS = ['company', 'person', 'opportunity', 'chore', 'note'];

const demo = (): MockClient => demoClient({ workspaceId: 'ws_test', manifests: [fixture], today: TODAY });

const failure = async (promise: Promise<unknown>): Promise<DeviasApiError> => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DeviasApiError);

    return error as DeviasApiError;
  }

  throw new Error('expected the call to reject');
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('mock metadata from the fixture manifest', () => {
  it('builds objects, fields, views, layouts, nav and commands', async () => {
    const client = demo();
    const schema = await client.metadata.getSchema();
    expect(schema.workspaceId).toBe('ws_test');
    expect(schema.version).toBeGreaterThan(0);
    expect(schema.objects.map((o) => o.nameSingular).sort()).toEqual([...OBJECTS].sort());
    expect(schema.fields).toHaveLength(33);
    expect(schema.views).toHaveLength(6);
    expect(schema.layouts).toHaveLength(3);
    // Three sections, each with the rows under it.
    const childrenOf = (label: string) => {
      const group = schema.navItems.find((n) => n.label === label);

      return schema.navItems
        .filter((n) => n.parentId === group?.id)
        .sort((a, b) => a.position - b.position)
        .map((n) => n.label);
    };
    expect(schema.navItems.filter((n) => n.parentId === null).map((n) => n.label)).toEqual([
      'Contacts',
      'Sales',
      'Activity',
    ]);
    expect(schema.navItems.filter((n) => n.target.kind === 'group')).toHaveLength(3);
    expect(childrenOf('Contacts')).toEqual(['People', 'Companies']);
    expect(childrenOf('Sales')).toEqual(['Pipeline', 'Opportunities']);
    expect(childrenOf('Activity')).toEqual(['Chores', 'Notes']);
    expect(schema.commandItems).toHaveLength(3);
    expect(schema.modules).toEqual([
      expect.objectContaining({
        id: '01a1751f-5f09-7114-9d75-ce42abd8a6ef',
        version: '0.2.0',
        manifestHash: hashManifest(fixture),
      }),
    ]);
    const rows = [
      ...schema.objects,
      ...schema.fields,
      ...schema.views,
      ...schema.layouts,
      ...schema.navItems,
      ...schema.commandItems,
    ];

    for (const row of rows) {
      expect(row.moduleId).toBe('01a1751f-5f09-7114-9d75-ce42abd8a6ef');
      expect(row.workspaceId).toBe('ws_test');
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }

    const index = indexSchema(schema);
    const person = index.objectsByName.get('person');
    expect(person).toMatchObject({
      id: ids.objects.person,
      primaryFieldId: ids.fields.person.first_name,
      isSystem: false,
    });
    expect(index.fieldsByObjectId.get(person?.id ?? '')?.map((f) => f.name)).toEqual([
      'first_name',
      'last_name',
      'email',
      'phone',
      'job_title',
      'company',
      'city',
      'linkedin',
    ]);
    expect(index.fieldsById.get(ids.fields.person.email)).toMatchObject({
      type: 'email',
      isUnique: true,
      isRequired: false,
      settings: {},
    });
    expect(index.fieldsById.get(ids.fields.person.company)?.settings).toEqual({
      relationType: 'many_to_one',
      targetObjectId: ids.objects.company,
      inverseLabel: 'People',
    });
    expect(index.fieldsById.get(ids.fields.opportunity.stage)).toMatchObject({
      defaultValue: 'new',
      isRequired: true,
    });
    const personLayout = index.layoutsByObjectId.get(person?.id ?? '')?.[0];
    expect(personLayout?.shell === 'tabs' ? personLayout.tabs[0]?.blocks : undefined).toHaveLength(5);
  });

  it('resolves view configs from the definitions', async () => {
    const client = demo();
    const index = indexSchema(await client.metadata.getSchema());
    const pipeline = index.viewsById.get(ids.views.opportunity.pipeline);
    expect(pipeline).toMatchObject({ label: 'Pipeline', type: 'kanban', isDefault: true, position: 0 });
    expect(pipeline?.config).toEqual({
      fields: [
        { fieldId: ids.fields.opportunity.name, visible: true },
        { fieldId: ids.fields.opportunity.amount, visible: true },
        { fieldId: ids.fields.opportunity.company, visible: true },
        { fieldId: ids.fields.opportunity.close_date, visible: true },
      ],
      sorts: [{ fieldId: ids.fields.opportunity.close_date, direction: 'asc' }],
      groupById: ids.fields.opportunity.stage,
      settings: { aggregate: { fieldId: ids.fields.opportunity.amount, operation: 'sum' } },
    });
    expect(index.viewsById.get(ids.views.person.all)?.config.fields[0]).toEqual({
      fieldId: ids.fields.person.first_name,
      width: 160,
      visible: true,
    });
    expect(index.viewsById.get(ids.views.chore.open)?.config.filter).toEqual({
      field: ids.fields.chore.done,
      op: 'eq',
      value: false,
    });
    const opportunity = index.objectsByName.get('opportunity');
    expect(index.viewsByObjectId.get(opportunity?.id ?? '')?.map((v) => v.label)).toEqual([
      'Pipeline',
      'All opportunities',
    ]);
  });
});

describe('mock records', () => {
  it('creates, reads, updates and soft-deletes records', async () => {
    const client = demo();
    const created = await client.records.create('person', { first_name: 'Grace', email: ' Grace@Example.ORG ' });
    expect(created).toMatchObject({
      first_name: 'Grace',
      email: 'grace@example.org',
      last_name: null,
      company: null,
      created_by: 'user_dev',
      updated_by: 'user_dev',
    });
    expect(created.id).toBeTypeOf('string');
    expect(created.created_at).toBe(created.updated_at);
    expect(await client.records.get('person', created.id)).toEqual(created);
    const updated = await client.records.update('person', created.id, { last_name: 'Hopper' });
    expect(updated.last_name).toBe('Hopper');
    expect(updated.updated_at >= created.updated_at).toBe(true);
    await client.records.delete('person', [created.id, 'missing-id']);
    const missing = await failure(client.records.get('person', created.id));
    expect(missing.status).toBe(404);
    expect(missing.code).toBe('NOT_FOUND');
    const page = await client.records.list(
      q('person')
        .where((f) => f.eq('id', created.id))
        .build(),
    );
    expect(page.items).toHaveLength(0);
    expect(
      client.store.recordsOf(client.store.objectByName('person')?.id ?? '').get(created.id)?.deleted_at,
    ).toBeTruthy();
  });

  it('rejects invalid writes with VALIDATION and details', async () => {
    const client = demo();
    const required = await failure(client.records.create('person', { last_name: 'Nobody' }));
    expect(required.status).toBe(400);
    expect(required.code).toBe('VALIDATION');
    expect(required.details).toEqual({
      issues: [{ field: 'first_name', message: expect.stringContaining('required') }],
    });
    const unknown = await failure(client.records.create('person', { first_name: 'X', nickname: 'y', id: 'forced' }));
    const issues = (unknown.details as { issues: { field: string }[] }).issues.map((issue) => issue.field).sort();
    expect(issues).toEqual(['id', 'nickname']);
    expect((await failure(client.records.create('company', { name: 'Typed', employees: 'many' }))).code).toBe(
      'VALIDATION',
    );
    expect((await failure(client.records.create('opportunity', { name: 'Deal', stage: 'bogus' }))).code).toBe(
      'VALIDATION',
    );
    const badRelation = await failure(client.records.create('person', { first_name: 'X', company: 'nope' }));
    expect(badRelation.code).toBe('VALIDATION');
    expect(badRelation.details).toEqual({
      issues: [{ field: 'company', message: expect.stringContaining('does not exist') }],
    });
    expect((await failure(client.records.create('unicorn', {}))).code).toBe('NOT_FOUND');
    const [somebody] = (await client.records.list(q('person').limit(1).build())).items;
    expect((await failure(client.records.update('person', somebody?.id ?? '', { first_name: null }))).code).toBe(
      'VALIDATION',
    );
  });

  it('applies field defaults', async () => {
    const client = demo();
    const [company] = (await client.records.list(q('company').limit(1).build())).items;
    const deal = await client.records.create('opportunity', { name: 'Deal', company: company?.id });
    expect(deal.stage).toBe('new');
    expect(deal.amount).toBeNull();
    expect((await client.records.create('chore', { title: 'Do it' })).done).toBe(false);
    expect((await client.records.create('company', { name: 'Fresh Co' })).ideal_customer_profile).toBe(false);
  });

  it('checks the value of a rich-text field the way the server does', async () => {
    const client = demo();
    await client.metadata.fields.create({
      objectId: ids.objects.company,
      name: 'brief',
      type: 'rich_text',
      label: 'Brief',
    });
    const link = (href: string) => ({ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href } }] });
    const doc = (href: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [link(href)] }] });

    expect((await failure(client.records.create('company', { name: 'A', brief: 3 }))).code).toBe('VALIDATION');
    expect(
      (await failure(client.records.create('company', { name: 'A', brief: { type: 'doc', content: 'x' } }))).code,
    ).toBe('VALIDATION');
    const created = await client.records.create('company', { name: 'A', brief: doc('javascript:alert(1)') });
    expect(JSON.stringify(created.brief)).not.toContain('javascript');
    expect(JSON.stringify(created.brief)).toContain('go');
    expect((await client.records.update('company', created.id, { brief: doc('https://example.com') })).brief).toEqual(
      doc('https://example.com'),
    );
  });

  it('enforces uniqueness, case-insensitively for emails', async () => {
    const client = demo();
    const [existing] = (
      await client.records.list(
        q('person')
          .where((f) => f.isNotEmpty('email'))
          .limit(1)
          .build(),
      )
    ).items;
    const dupe = await failure(
      client.records.create('person', { first_name: 'Dupe', email: String(existing?.email).toUpperCase() }),
    );
    expect(dupe.status).toBe(409);
    expect(dupe.code).toBe('UNIQUE_VIOLATION');
    expect(dupe.details).toMatchObject({ field: 'email', recordId: existing?.id });
    const [company] = (await client.records.list(q('company').limit(1).build())).items;
    expect((await failure(client.records.create('company', { name: company?.name }))).code).toBe('UNIQUE_VIOLATION');
    await expect(
      client.records.update('person', existing?.id ?? '', { email: existing?.email }),
    ).resolves.toBeDefined();
    const [other] = (
      await client.records.list(
        q('person')
          .where((f) => f.neq('id', existing?.id))
          .limit(1)
          .build(),
      )
    ).items;
    expect((await failure(client.records.update('person', other?.id ?? '', { email: existing?.email }))).code).toBe(
      'UNIQUE_VIOLATION',
    );
  });

  it('filters, sorts and paginates the seed with cursors', async () => {
    const client = demo();
    const customers = await client.records.list(
      q('opportunity')
        .where((f) => f.eq('stage', 'customer'))
        .count()
        .build(),
    );
    expect(customers.items.length).toBeGreaterThan(0);
    expect(customers.items.every((o) => o.stage === 'customer')).toBe(true);
    expect(customers.totalCount).toBe(customers.items.length);

    const byAmount = await client.records.list(q('opportunity').orderBy('amount', 'desc').build());
    const amounts = byAmount.items.map((o) => o.amount as number);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));

    const recent = await client.records.list(q('note').build());
    const stamps = recent.items.map((n) => n.updatedAt);
    expect(stamps).toEqual([...stamps].sort().reverse());

    const all = await client.records.list(q('person').orderBy('first_name').limit(200).build());
    expect(all.items).toHaveLength(40);
    const walked: string[] = [];
    let cursor: string | null | undefined;
    let pages = 0;
    let total: number | undefined;

    do {
      const page = await client.records.list(q('person').orderBy('first_name').limit(7).cursor(cursor).count().build());
      walked.push(...page.items.map((p) => p.id));
      cursor = page.nextCursor;
      total = page.totalCount;
      pages += 1;
    } while (cursor);

    expect(pages).toBe(6);
    expect(total).toBe(40);
    expect(walked).toEqual(all.items.map((p) => p.id));
    expect(new Set(walked).size).toBe(40);

    const firstPage = await client.records.list(q('person').orderBy('first_name').limit(7).build());
    const mismatch = await failure(
      client.records.list(q('person').orderBy('last_name').limit(7).cursor(firstPage.nextCursor).build()),
    );
    expect(mismatch.code).toBe('INVALID_CURSOR');
    expect(mismatch.status).toBe(400);
    expect((await failure(client.records.list(q('person').cursor('not-a-cursor').build()))).code).toBe(
      'INVALID_CURSOR',
    );
    expect(
      (
        await failure(
          client.records.list(
            q('person')
              .where((f) => f.eq('nope', 1))
              .build(),
          ),
        )
      ).code,
    ).toBe('VALIDATION');

    const projected = await client.records.list(q('person').select('first_name').limit(1).build());
    expect(Object.keys(projected.items[0] ?? {}).sort()).toEqual([
      'created_at',
      'created_by',
      'first_name',
      'id',
      'updated_at',
      'updated_by',
    ]);

    const searched = await client.records.list(q('person').search('ada').build());
    expect(searched.items.some((p) => p.first_name === 'Ada')).toBe(true);
    const searchable = ['first_name', 'last_name', 'email', 'phone', 'job_title', 'city', 'linkedin'];
    expect(
      searched.items.every((p) =>
        searchable.some((key) =>
          String(p[key] ?? '')
            .toLowerCase()
            .includes('ada'),
        ),
      ),
    ).toBe(true);

    const open = await client.records.list(
      q('chore')
        .where((f) => f.and(f.eq('done', false), f.gte('due_date', TODAY)))
        .orderBy('due_date')
        .build(),
    );
    expect(open.items.length).toBeGreaterThan(0);
    expect(open.items.every((t) => t.done === false && String(t.due_date) >= TODAY)).toBe(true);
  });

  it('includes many-to-one relations', async () => {
    const client = demo();
    const page = await client.records.list(
      q('opportunity')
        .include('company')
        .include('point_of_contact', { select: ['first_name'], limit: 3 })
        .limit(5)
        .build(),
    );
    const companyIds = new Set(page.items.map((o) => o.company));
    expect(page.included?.company).toHaveLength(companyIds.size);
    expect(page.included?.company?.every((c) => companyIds.has(c.id) && typeof c.name === 'string')).toBe(true);
    const contacts = page.included?.point_of_contact ?? [];
    expect(contacts.length).toBeLessThanOrEqual(3);

    for (const contact of contacts) {
      expect(Object.keys(contact).sort()).toEqual([
        'created_at',
        'created_by',
        'first_name',
        'id',
        'updated_at',
        'updated_by',
      ]);
    }

    expect((await failure(client.records.list(q('opportunity').include('name').build()))).code).toBe('VALIDATION');
  });

  it('searches across objects', async () => {
    const client = demo();
    const hits = await client.records.lookup({ text: 'acme' });
    expect(hits.some((h) => h.object === 'company' && h.title === 'Acme Corp')).toBe(true);
    expect(hits.some((h) => h.object === 'opportunity' && h.title.startsWith('Acme Corp'))).toBe(true);

    for (const hit of hits) {
      expect(hit).toMatchObject({
        objectId: expect.any(String),
        recordId: expect.any(String),
        title: expect.any(String),
      });
    }

    const onlyCompanies = await client.records.lookup({ text: 'acme', objects: ['company'], limit: 1 });
    expect(onlyCompanies).toHaveLength(1);
    expect(onlyCompanies[0]?.object).toBe('company');
    expect((await failure(client.records.lookup({ text: '' }))).code).toBe('VALIDATION');
  });

  it('delivers events to subscribers in order with dense sequences', async () => {
    const client = demo();
    const received: WorkspaceEvent[] = [];
    const statuses: string[] = [];
    const stop = client.events.subscribe((event) => received.push(event), { onStatus: (s) => statuses.push(s) });
    const person = await client.records.create('person', { first_name: 'Eve' });
    await client.records.update('person', person.id, { last_name: 'Online', city: 'Oslo' });
    await client.records.delete('person', [person.id]);
    const object = await client.metadata.objects.create({
      nameSingular: 'thing',
      namePlural: 'things',
      labelSingular: 'Thing',
      labelPlural: 'Things',
    });
    await flush();
    expect(statuses).toEqual(['connecting', 'open']);
    expect(received.map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    expect(received.map((e) => e.type)).toEqual([
      'record.created',
      'record.updated',
      'record.deleted',
      'metadata.changed',
    ]);
    expect(received[0]).toMatchObject({
      object: 'person',
      recordId: person.id,
      workspaceId: 'ws_test',
      actor: { kind: 'user', id: 'user_dev' },
    });
    expect((received[1] as { changedFields?: string[] }).changedFields).toEqual(['last_name', 'city']);
    const schema = await client.metadata.getSchema();
    expect(received[3]).toMatchObject({ entity: 'object', entityId: object.id, metadataVersion: schema.version });
    stop();
    expect(statuses.at(-1)).toBe('closed');
    await client.records.create('person', { first_name: 'Late' });
    await flush();
    expect(received).toHaveLength(4);

    const replayed: number[] = [];
    const stopReplay = client.events.subscribe((event) => replayed.push(event.sequence), { after: 2 });
    await flush();
    expect(replayed).toEqual([3, 4, 5]);
    stopReplay();
  });
});

describe('mock metadata CRUD', () => {
  it('makes an object with its fields, table and sidebar row as one change, or nothing', async () => {
    const client = demo();
    const received: number[] = [];
    client.events.subscribe((event) => void received.push(event.sequence));
    const object = await client.metadata.objects.create({
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
    });
    const fields = (await client.metadata.fields.list()).filter((f) => f.objectId === object.id);
    expect(fields.map((f) => f.name)).toEqual(['name', 'twin']);
    expect(object.primaryFieldId).toBe(fields[0]?.id);
    expect(fields[1]?.settings).toMatchObject({ targetObjectId: object.id });
    const views = (await client.metadata.views.list()).filter((v) => v.objectId === object.id);
    expect(views).toHaveLength(1);
    expect(views[0]?.config.fields.map((f) => f.fieldId)).toEqual(fields.map((f) => f.id));
    const rows = (await client.metadata.navItems.list()).filter((n) => n.label === 'Gizmos');
    expect(rows).toHaveLength(1);
    expect(received).toHaveLength(1);

    const before = (await client.metadata.getSchema()).version;
    const refused = await failure(
      client.metadata.objects.create({
        nameSingular: 'half',
        namePlural: 'halves',
        labelSingular: 'Half',
        labelPlural: 'Halves',
        fields: [
          { name: 'a', type: 'text', label: 'A' },
          { name: 'a', type: 'text', label: 'A again' },
        ],
      }),
    );
    expect(['CONFLICT', 'VALIDATION']).toContain(refused.code);
    expect((await client.metadata.objects.list()).some((o) => o.nameSingular === 'half')).toBe(false);
    expect((await client.metadata.getSchema()).version).toBe(before);
  });

  it('creates workspace-owned rows and protects module-owned ones', async () => {
    const client = demo();
    const before = (await client.metadata.getSchema()).version;
    const object = await client.metadata.objects.create({
      nameSingular: 'project',
      namePlural: 'projects',
      labelSingular: 'Project',
      labelPlural: 'Projects',
      icon: 'folder',
    });
    expect(object.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    expect(object.moduleId).toBeNull();
    expect(object.isSystem).toBe(false);
    const dupe = await failure(
      client.metadata.objects.create({ nameSingular: 'person', namePlural: 'x', labelSingular: 'P', labelPlural: 'P' }),
    );
    expect(dupe.code).toBe('CONFLICT');

    const name = await client.metadata.fields.create({
      objectId: object.id,
      name: 'name',
      type: 'text',
      label: 'Name',
    });
    const owner = await client.metadata.fields.create({
      objectId: object.id,
      name: 'owner',
      type: 'relation',
      label: 'Owner',
      settings: { relationType: 'many_to_one', targetObjectId: ids.objects.person },
    });
    expect(name.position).toBe(0);
    expect(owner.position).toBe(1);
    expect(
      (await failure(client.metadata.fields.create({ objectId: object.id, name: 'id', type: 'text', label: 'Id' })))
        .code,
    ).toBe('VALIDATION');
    expect(
      (
        await failure(
          client.metadata.fields.create({
            objectId: object.id,
            name: 'x',
            type: 'relation',
            label: 'X',
            settings: { relationType: 'many_to_one', targetObjectId: 'nope.x' },
          }),
        )
      ).code,
    ).toBe('VALIDATION');
    expect(
      (
        await failure(
          client.metadata.fields.create({
            objectId: object.id,
            name: 'y',
            type: 'select',
            label: 'Y',
            settings: { options: [] },
          }),
        )
      ).code,
    ).toBe('VALIDATION');

    const view = await client.metadata.views.create({ objectId: object.id, label: 'All projects', type: 'kanban' });
    const projectFields = (await client.metadata.fields.list()).filter((f) => f.objectId === object.id);
    const idOf = (name: string) => projectFields.find((f) => f.name === name)?.id;
    expect(view.config.fields).toEqual([
      { fieldId: idOf('name'), visible: true },
      { fieldId: idOf('owner'), visible: true },
    ]);
    const renamed = await client.metadata.views.update(view.id, { label: 'Projects', config: { groupById: 'owner' } });
    expect(renamed).toMatchObject({ label: 'Projects', type: 'kanban' });
    expect(renamed.config.groupById).toBe(idOf('owner'));
    expect(renamed.config.fields).toHaveLength(2);
    const ungrouped = await client.metadata.views.update(view.id, { config: { groupById: null } });
    expect(ungrouped.config.groupById).toBeUndefined();

    const [somebody] = (await client.records.list(q('person').limit(1).build())).items;
    const record = await client.records.create('project', { name: 'Website relaunch', owner: somebody?.id });
    expect(record.owner).toBe(somebody?.id);

    const person = (await client.metadata.objects.list()).find((o) => o.nameSingular === 'person');
    expect((await failure(client.metadata.objects.delete(person?.id ?? ''))).code).toBe('CONFLICT');
    const layout = await client.metadata.layouts.create({
      objectId: 'projects',
      label: 'Project',
      shell: 'tabs',
      tabs: [{ name: 'main', label: 'Main', blocks: [] }],
    });
    expect(layout.kind).toBe('record');
    expect(layout.shell).toBe('tabs');
    // A shape holds exactly its own keys, like the engine: a `column` takes `blocks`, not `tabs`.
    const noBlocks = client.metadata.layouts.update(layout.id, { shell: 'column' });
    expect((await failure(noBlocks)).message).toMatch(/needs `blocks`/);
    const column = await client.metadata.layouts.update(layout.id, { shell: 'column', blocks: [] });
    expect(column.shell).toBe('column');
    expect('tabs' in column).toBe(false);
    const stray = client.metadata.layouts.update(layout.id, { tabs: [{ name: 'a', label: 'A', blocks: [] }] });
    expect((await failure(stray)).message).toMatch(/column" layout is one list of `blocks`, so it has no `tabs`/);
    await client.metadata.layouts.update(layout.id, {
      shell: 'tabs',
      tabs: [{ name: 'main', label: 'Main', blocks: [] }],
    });
    // Objects can be named like the engine allows: here by plural name.
    expect(layout.objectId).toBe(object.id);
    const guessed = client.metadata.layouts.create({
      objectId: object.id,
      label: 'Guessed',
      shell: 'tabs',
      tabs: [
        {
          name: 'main',
          label: 'Main',
          blocks: [{ name: 'fields', blockId: '01a17522-1ec0-7239-918f-32808fbbd7c2', config: {} }],
        },
      ],
    });
    expect((await failure(guessed)).code).toBe('VALIDATION');
    // The header block is optional, kept when given and checked like the tabs.
    const headed = await client.metadata.layouts.update(layout.id, {
      header: { name: 'head', blockId: coreIds.blocks.fields, config: {} },
    });
    expect(headed.shell === 'tabs' ? headed.header?.blockId : undefined).toBe(coreIds.blocks.fields);
    const badHeader = client.metadata.layouts.update(layout.id, {
      header: { name: 'x', blockId: '01a17522-1ec0-7239-918f-32808fbbd7c2', config: {} },
    });
    expect((await failure(badHeader)).message).toMatch(/^Header, cell "x"/);
    // The module actions the page offers as buttons: a list is exactly what shows, none by default.
    expect(layout.actions).toEqual([]);
    expect((await client.metadata.layouts.update(layout.id, { actions: [] })).actions).toEqual([]);
    const badAction = client.metadata.layouts.update(layout.id, {
      actions: [{ actionId: '01a1751f-5f0e-7530-b194-eb96c8a64846', input: 'id' }],
    });
    expect((await failure(badAction)).message).toMatch(
      /^Actions: "01a1751f-5f0e-7530-b194-eb96c8a64846" is not an action of an installed module/,
    );
    const nav = await client.metadata.navItems.create({
      label: 'Projects',
      target: { kind: 'object', objectId: object.id },
    });
    // After the three sections and the row the new object made for itself.
    expect(nav.position).toBe(4);
    const command = await client.metadata.commandItems.create({
      label: 'New project',
      action: { kind: 'create_record', objectId: object.id },
    });
    expect((await client.metadata.commandItems.list()).map((c) => c.id)).toContain(command.id);

    await client.metadata.objects.delete(object.id);
    const schema = await client.metadata.getSchema();
    expect(schema.objects.find((o) => o.id === object.id)).toBeUndefined();
    expect(schema.fields.some((f) => f.objectId === object.id)).toBe(false);
    expect(schema.views.some((v) => v.id === view.id)).toBe(false);
    expect(schema.layouts.some((l) => l.id === layout.id)).toBe(false);
    // Nav and command items name the object in their target, so they go with it; the fixture's own stay.
    expect(schema.navItems.some((n) => n.id === nav.id)).toBe(false);
    expect(schema.commandItems.some((c) => c.id === command.id)).toBe(false);
    expect(schema.navItems.some((n) => n.id === ids.nav.people)).toBe(true);
    expect(schema.version).toBeGreaterThan(before);
    expect((await failure(client.metadata.fields.get(name.id))).code).toBe('NOT_FOUND');
    expect((await failure(client.records.get('project', record.id))).code).toBe('NOT_FOUND');
  });
});

describe('demo data fixture', () => {
  it('is deterministic and covers the pipeline', () => {
    const a = demo();
    const b = demo();
    const records = (client: MockClient, name: string) =>
      client.store.liveRecords(client.store.objectByName(name)?.id ?? '');

    for (const name of OBJECTS) {
      expect(records(a, name)).toEqual(records(b, name));
    }

    const counts = Object.fromEntries(OBJECTS.map((name) => [name, records(a, name).length]));
    expect(counts).toEqual({ company: 15, person: 40, opportunity: 20, chore: 25, note: 20 });
    const stages = new Set(records(a, 'opportunity').map((o) => o.stage));
    expect([...stages].sort()).toEqual(OPPORTUNITY_STAGES.map((s) => s.value).sort());
    expect(
      records(a, 'opportunity').every((o) => typeof o.amount === 'number' && typeof o.close_date === 'string'),
    ).toBe(true);
    expect(records(a, 'chore').every((t) => typeof t.person === 'string')).toBe(true);
    expect(records(a, 'note').every((n) => typeof n.person === 'string' && typeof n.company === 'string')).toBe(true);
    const other = demoClient({ workspaceId: 'ws_test', manifests: [fixture], today: TODAY, seed: 7 });
    expect(records(other, 'person')).not.toEqual(records(a, 'person'));
    expect(() => seedDemo(createMockClient({ workspaceId: 'x' }))).toThrow(/fixture/);
  });

  it('keeps the fixture out of the event feed and honours latency', async () => {
    const client = createMockClient({ workspaceId: 'ws_x', manifests: [fixture], latency: 5 });
    seedDemo(client);
    const started = Date.now();
    const page = await client.records.list(q('company').count().build());
    expect(Date.now() - started).toBeGreaterThanOrEqual(4);
    expect(page.totalCount).toBe(15);
    expect(client.store.events).toHaveLength(0);
  });
});

describe('mock delete rules', () => {
  it('deletes only what an object\u2019s rule allows, and takes the records that cascade with it', async () => {
    const client = createMockClient({ workspaceId: 'ws_rules', manifests: [] });
    const order = await client.metadata.objects.create({
      nameSingular: 'order',
      namePlural: 'orders',
      labelSingular: 'Order',
      labelPlural: 'Orders',
      deleteWhen: { field: 'status', op: 'eq', value: 'draft' },
    });
    const line = await client.metadata.objects.create({
      nameSingular: 'line',
      namePlural: 'lines',
      labelSingular: 'Line',
      labelPlural: 'Lines',
    });
    await client.metadata.fields.create({ objectId: order.id, name: 'status', type: 'text', label: 'Status' });
    await client.metadata.fields.create({
      objectId: line.id,
      name: 'order',
      type: 'relation',
      label: 'Order',
      settings: { relationType: 'many_to_one', targetObjectId: order.id, onDelete: 'cascade' },
    });
    const draft = await client.records.create('order', { status: 'draft' });
    const sent = await client.records.create('order', { status: 'sent' });
    const onDraft = await client.records.create('line', { order: draft.id });
    const onSent = await client.records.create('line', { order: sent.id });

    // The whole call fails when one record is not allowed to go.
    const refused = await failure(client.records.delete('order', [draft.id, sent.id]));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('CONFLICT');
    expect((await client.records.get('order', draft.id)).id).toBe(draft.id);

    await client.records.delete('order', [draft.id]);
    expect((await failure(client.records.get('order', draft.id))).code).toBe('NOT_FOUND');
    expect((await failure(client.records.get('line', onDraft.id))).code).toBe('NOT_FOUND');
    expect((await client.records.get('line', onSent.id)).id).toBe(onSent.id);

    // `null` removes the rule.
    const updated = await client.metadata.objects.update(order.id, { deleteWhen: null });
    expect(updated.deleteWhen).toBeUndefined();
    await client.records.delete('order', [sent.id]);
    expect((await failure(client.records.get('line', onSent.id))).code).toBe('NOT_FOUND');
  });
});

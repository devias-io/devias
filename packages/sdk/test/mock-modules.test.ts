import { hashManifest, type ModuleManifest, parseManifest } from '@devias/core';
import { manifest as fixture, ids } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError, q } from '../src';
import { createMockClient, type StorageLike } from '../src/mock';
import { demoClient } from './demo-data';

const TODAY = '2026-09-21';

const eventFields = [
  {
    id: '01a1751f-5f17-70dd-a237-86090192ecf1',
    name: 'title',
    label: 'Title',
    type: 'text',
    isRequired: true,
    position: 0,
  },
  {
    id: '01a1751f-5f17-70dd-a237-89a434c67a7a',
    name: 'starts_at',
    label: 'Starts at',
    type: 'date_time',
    position: 1,
  },
  {
    id: '01a1751f-5f17-70dd-a237-8e007619d0ed',
    name: 'company',
    label: 'Company',
    type: 'relation',
    settings: { relationType: 'many_to_one', targetObjectId: ids.objects.company },
    position: 2,
  },
];

const eventObject = {
  id: '01a1751f-5f17-70dd-a237-91c093c63878',
  nameSingular: 'event',
  namePlural: 'events',
  labelSingular: 'Event',
  labelPlural: 'Events',
  icon: 'calendar',
  fields: eventFields,
};

const eventsManifest = (overrides: Partial<ModuleManifest> = {}): ModuleManifest =>
  parseManifest({
    id: '01a1751f-5f17-70dd-a237-b4dba4f4302e',
    version: '1.0.0',
    objects: [eventObject],
    fields: [
      {
        id: '01a1751f-5f17-70dd-a237-96bbdcfc51ff',
        objectId: ids.objects.person,
        name: 'birthday',
        label: 'Birthday',
        type: 'date',
        position: 20,
      },
    ],
    views: [
      {
        id: '01a1751f-5f17-70dd-a237-9ad14ca4959a',
        objectId: '01a1751f-5f17-70dd-a237-91c093c63878',
        label: 'All events',
        isDefault: true,
      },
    ],
    navItems: [
      {
        id: '01a1751f-5f17-70dd-a237-9c4754a7538e',
        label: 'Events',
        icon: 'calendar',
        target: { kind: 'object', objectId: '01a1751f-5f17-70dd-a237-91c093c63878' },
        position: 10,
      },
    ],
    commandItems: [
      {
        id: '01a1751f-5f17-70dd-a237-a168d486cab4',
        label: 'New event',
        action: { kind: 'create_record', objectId: '01a1751f-5f17-70dd-a237-91c093c63878' },
      },
    ],
    ...overrides,
  });

const demo = () => demoClient({ workspaceId: 'ws_ext', manifests: [fixture], today: TODAY });

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

describe('mock modules', () => {
  it('plans and applies a second manifest, then re-applies as a no-op', async () => {
    const client = demo();
    const manifest = eventsManifest();
    const plan = await client.modules.plan(manifest);
    expect(plan).toMatchObject({
      moduleId: '01a1751f-5f17-70dd-a237-b4dba4f4302e',
      fromVersion: null,
      toVersion: '1.0.0',
      manifestHash: hashManifest(manifest),
      hasDestructive: false,
      hasConflicts: false,
    });
    expect(plan.changes).toHaveLength(8);
    expect(plan.changes.every((c) => c.action === 'create')).toBe(true);
    expect(plan.changes.map((c) => c.kind)).toEqual([
      'object',
      'field',
      'field',
      'field',
      'field',
      'view',
      'nav_item',
      'command_item',
    ]);
    expect((await client.modules.plan(manifest)).planHash).toBe(plan.planHash);

    const before = (await client.metadata.getSchema()).version;
    const events: string[] = [];
    const stop = client.events.subscribe((event) => events.push(event.type));
    const result = await client.modules.apply(manifest, { expectedPlanHash: plan.planHash });
    await flush();
    stop();
    expect(events).toEqual(['metadata.changed', 'module.applied']);
    expect(result.applied).toHaveLength(8);
    expect(result.metadataVersion).toBeGreaterThan(before);
    expect(result.manifestHash).toBe(plan.manifestHash);
    expect((await client.modules.list()).map((e) => e.id).sort()).toEqual(
      ['01a1751f-5f17-70dd-a237-b4dba4f4302e', '01a1751f-5f09-7114-9d75-ce42abd8a6ef'].sort(),
    );

    const schema = await client.metadata.getSchema();
    const event = schema.objects.find((o) => o.nameSingular === 'event');
    expect(event?.moduleId).toBe('01a1751f-5f17-70dd-a237-b4dba4f4302e');
    expect(schema.fields.filter((f) => f.objectId === event?.id).map((f) => f.name)).toEqual([
      'title',
      'starts_at',
      'company',
    ]);
    const person = schema.objects.find((o) => o.nameSingular === 'person');
    expect(schema.fields.find((f) => f.id === '01a1751f-5f17-70dd-a237-96bbdcfc51ff')).toMatchObject({
      objectId: person?.id,
      moduleId: '01a1751f-5f17-70dd-a237-b4dba4f4302e',
      type: 'date',
      position: 20,
    });
    expect(schema.views.find((v) => v.id === '01a1751f-5f17-70dd-a237-9ad14ca4959a')?.config.fields).toEqual([
      { fieldId: '01a1751f-5f17-70dd-a237-86090192ecf1', visible: true },
      { fieldId: '01a1751f-5f17-70dd-a237-89a434c67a7a', visible: true },
      { fieldId: '01a1751f-5f17-70dd-a237-8e007619d0ed', visible: true },
    ]);
    expect(schema.navItems.at(-1)?.label).toBe('Events');

    const [company] = (await client.records.list(q('company').limit(1).build())).items;
    const created = await client.records.create('event', {
      title: 'Kickoff',
      starts_at: '2026-10-01T10:00:00Z',
      company: company?.id,
    });
    expect(created.starts_at).toBe('2026-10-01T10:00:00.000Z');
    const [somebody] = (await client.records.list(q('person').limit(1).build())).items;
    expect((await client.records.update('person', somebody?.id ?? '', { birthday: '1990-05-04' })).birthday).toBe(
      '1990-05-04',
    );

    const again = await client.modules.plan(manifest);
    expect(again.fromVersion).toBe('1.0.0');
    expect(again.changes.every((c) => c.action === 'noop')).toBe(true);
    const reapplied = await client.modules.apply(manifest);
    expect(reapplied.applied).toEqual([]);
    expect(reapplied.metadataVersion).toBe(result.metadataVersion);
  });

  it('flags destructive updates and deletes and requires allowDestructive', async () => {
    const client = demo();
    await client.modules.apply(eventsManifest());
    const v2 = eventsManifest({
      version: '1.1.0',
      navItems: [],
      objects: [
        {
          ...eventObject,
          fields: [
            eventFields[0] as (typeof eventFields)[number],
            { ...(eventFields[1] as (typeof eventFields)[number]), label: 'Starts on', type: 'date' },
            eventFields[2] as (typeof eventFields)[number],
            {
              id: '01a1751f-5f17-70dd-a237-a55f23d8b41a',
              name: 'location',
              label: 'Location',
              type: 'text',
              position: 3,
            },
          ],
        },
      ],
    } as Partial<ModuleManifest>);
    const plan = await client.modules.plan(v2);
    expect(plan.fromVersion).toBe('1.0.0');
    expect(plan.toVersion).toBe('1.1.0');
    expect(plan.hasDestructive).toBe(true);
    expect(plan.hasConflicts).toBe(false);
    const byId = new Map(plan.changes.map((c) => [c.id, c]));
    expect(byId.get('01a1751f-5f17-70dd-a237-89a434c67a7a')).toMatchObject({
      action: 'update',
      destructive: true,
      diff: { type: { from: 'date_time', to: 'date' }, label: { from: 'Starts at', to: 'Starts on' } },
    });
    expect(byId.get('01a1751f-5f17-70dd-a237-a55f23d8b41a')).toMatchObject({ action: 'create', destructive: false });
    expect(byId.get('01a1751f-5f17-70dd-a237-9c4754a7538e')).toMatchObject({ action: 'delete', destructive: false });
    expect(byId.get('01a1751f-5f17-70dd-a237-91c093c63878')?.action).toBe('noop');

    const refused = await failure(client.modules.apply(v2));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('DESTRUCTIVE_CHANGE');
    const mismatch = await failure(client.modules.apply(v2, { allowDestructive: true, expectedPlanHash: 'stale' }));
    expect(mismatch.code).toBe('PLAN_MISMATCH');

    const result = await client.modules.apply(v2, { allowDestructive: true, expectedPlanHash: plan.planHash });
    expect(result.version).toBe('1.1.0');
    expect(result.applied.map((c) => c.action).sort()).toEqual(['create', 'delete', 'update']);
    const schema = await client.metadata.getSchema();
    expect(schema.fields.find((f) => f.id === '01a1751f-5f17-70dd-a237-89a434c67a7a')?.type).toBe('date');
    expect(schema.fields.some((f) => f.id === '01a1751f-5f17-70dd-a237-a55f23d8b41a')).toBe(true);
    expect(schema.navItems.some((n) => n.id === '01a1751f-5f17-70dd-a237-9c4754a7538e')).toBe(false);
    expect((await client.modules.list()).find((e) => e.id === '01a1751f-5f17-70dd-a237-b4dba4f4302e')?.version).toBe(
      '1.1.0',
    );
  });

  it('reports conflicts and missing dependencies instead of touching foreign rows', async () => {
    const client = demo();
    const clash = parseManifest({
      id: '01a1751f-5f18-7600-95e3-d37fee653d61',
      version: '1.0.0',
      fields: [
        {
          id: '01a1751f-5f17-70dd-a237-aa053ad73790',
          objectId: ids.objects.person,
          name: 'email',
          label: 'Email 2',
          type: 'text',
        },
      ],
    });
    const plan = await client.modules.plan(clash);
    expect(plan.hasConflicts).toBe(true);
    expect(plan.changes[0]).toMatchObject({ action: 'conflict', reason: expect.stringContaining('already used') });
    const conflict = await failure(client.modules.apply(clash));
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('CONFLICT');

    const dangling = parseManifest({
      id: '01a1751f-5f18-7600-95e3-d5365baa4d76',
      version: '1.0.0',
      views: [
        { id: '01a1751f-5f17-70dd-a237-ac9213b7a679', objectId: '01a1751f-5f17-70dd-a237-b2b76f009b6a', label: 'X' },
      ],
    });
    const missing = await failure(client.modules.apply(dangling));
    expect(missing.status).toBe(422);
    expect(missing.code).toBe('MISSING_DEPENDENCY');

    expect((await client.modules.list()).map((e) => e.id)).toEqual(['01a1751f-5f09-7114-9d75-ce42abd8a6ef']);
    expect((await client.metadata.getSchema()).fields.filter((f) => f.name === 'email')).toHaveLength(1);
    expect((await failure(client.modules.apply({ id: 'Bad Id', version: 'x' } as never))).code).toBe('VALIDATION');
  });

  it('leaves workspace-owned rows alone and uninstalls cleanly', async () => {
    const client = demo();
    await client.modules.apply(eventsManifest());
    const event = (await client.metadata.objects.list()).find((o) => o.nameSingular === 'event');
    const custom = await client.metadata.fields.create({
      objectId: event?.id ?? '',
      name: 'notes',
      type: 'text',
      label: 'Notes',
    });
    const customNav = await client.metadata.navItems.create({
      label: 'Mine',
      target: { kind: 'url', url: 'https://example.com' },
    });
    await client.records.create('event', { title: 'Party' });

    const plan = await client.modules.plan(eventsManifest());
    expect(plan.changes.every((c) => c.action === 'noop')).toBe(true);
    expect(plan.changes.some((c) => c.id === custom.id)).toBe(false);
    const view = (await client.metadata.views.list()).find((v) => v.id === '01a1751f-5f17-70dd-a237-9ad14ca4959a');
    expect(view?.config.fields.map((f) => f.fieldId)).toEqual([
      '01a1751f-5f17-70dd-a237-86090192ecf1',
      '01a1751f-5f17-70dd-a237-89a434c67a7a',
      '01a1751f-5f17-70dd-a237-8e007619d0ed',
    ]);

    const refused = await failure(client.modules.uninstall('01a1751f-5f17-70dd-a237-b4dba4f4302e'));
    expect(refused.code).toBe('DESTRUCTIVE_CHANGE');
    const result = await client.modules.uninstall('01a1751f-5f17-70dd-a237-b4dba4f4302e', { allowDestructive: true });
    expect(result.moduleId).toBe('01a1751f-5f17-70dd-a237-b4dba4f4302e');
    expect(result.applied.some((c) => c.kind === 'object' && c.action === 'delete')).toBe(true);
    expect(result.applied.find((c) => c.id === custom.id)).toMatchObject({
      action: 'delete',
      reason: expect.stringContaining('Cascade'),
    });

    const schema = await client.metadata.getSchema();
    expect(schema.modules.map((e) => e.id)).toEqual(['01a1751f-5f09-7114-9d75-ce42abd8a6ef']);
    expect(schema.objects.map((o) => o.nameSingular).sort()).toEqual([
      'chore',
      'company',
      'note',
      'opportunity',
      'person',
    ]);
    expect(schema.fields).toHaveLength(33);
    expect(schema.navItems.find((n) => n.id === customNav.id)).toBeDefined();
    expect(schema.navItems.some((n) => n.id === '01a1751f-5f17-70dd-a237-9c4754a7538e')).toBe(false);
    expect((await failure(client.records.get('event', 'x'))).code).toBe('NOT_FOUND');
    expect((await failure(client.modules.uninstall('01a1751f-5f17-70dd-a237-b4dba4f4302e'))).code).toBe('NOT_FOUND');

    const core = await client.modules.plan(fixture);
    expect(core.changes.every((c) => c.action === 'noop')).toBe(true);
  });

  it('persists to storage and restores on the next start', async () => {
    const data = new Map<string, string>();
    const storage: StorageLike = {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
      removeItem: (key) => {
        data.delete(key);
      },
    };
    const first = demoClient({
      workspaceId: 'ws_p',
      manifests: [fixture],
      today: TODAY,
      persist: { key: 'devias', storage },
    });
    const created = await first.records.create('company', { name: 'Persisted Co' });
    await flush();
    expect(data.has('devias')).toBe(true);

    // A restored snapshot is not seeded again.
    const second = createMockClient({ workspaceId: 'ws_p', manifests: [fixture], persist: { key: 'devias', storage } });
    expect(await second.records.get('company', created.id)).toEqual(created);
    expect((await second.records.list(q('company').count().build())).totalCount).toBe(16);
    expect(second.store.events).toHaveLength(1);
    expect((await second.modules.plan(fixture)).changes.every((c) => c.action === 'noop')).toBe(true);

    const other = createMockClient({
      workspaceId: 'ws_other',
      manifests: [fixture],
      persist: { key: 'devias', storage },
    });
    expect((await other.records.list(q('company').count().build())).totalCount).toBe(0);

    second.reset();
    expect((await second.records.list(q('company').count().build())).totalCount).toBe(0);
    expect(second.store.events).toHaveLength(0);
  });
});

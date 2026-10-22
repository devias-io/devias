import { hashManifest, type ModuleManifest, parseManifest } from '@devias/core';
import { manifest as fixture, ids } from '@devias/fixtures';
import { describe, expect, it } from 'vitest';
import { DeviasApiError, q } from '../src';
import { createMockClient, type StorageLike } from '../src/mock';
import { demoClient } from './demo-data';

const TODAY = '2026-09-21';

const eventFields = [
  {
    id: 'ext-events.event.title',
    name: 'title',
    label: 'Title',
    type: 'text',
    isRequired: true,
    position: 0,
  },
  {
    id: 'ext-events.event.starts_at',
    name: 'starts_at',
    label: 'Starts at',
    type: 'date_time',
    position: 1,
  },
  {
    id: 'ext-events.event.company',
    name: 'company',
    label: 'Company',
    type: 'relation',
    settings: { relationType: 'many_to_one', targetObjectId: ids.objects.company },
    position: 2,
  },
];

const eventObject = {
  id: 'ext-events.event',
  nameSingular: 'event',
  namePlural: 'events',
  labelSingular: 'Event',
  labelPlural: 'Events',
  icon: 'calendar',
  fields: eventFields,
};

const eventsManifest = (overrides: Partial<ModuleManifest> = {}): ModuleManifest =>
  parseManifest({
    id: 'ext-events',
    version: '1.0.0',
    objects: [eventObject],
    fields: [
      {
        id: 'ext-events.person.birthday',
        objectId: ids.objects.person,
        name: 'birthday',
        label: 'Birthday',
        type: 'date',
        position: 20,
      },
    ],
    views: [
      {
        id: 'ext-events.event.all',
        objectId: 'ext-events.event',
        label: 'All events',
        isDefault: true,
      },
    ],
    navItems: [
      {
        id: 'ext-events.events',
        label: 'Events',
        icon: 'calendar',
        target: { kind: 'object', objectId: 'ext-events.event' },
        position: 10,
      },
    ],
    commandItems: [
      {
        id: 'ext-events.new_event',
        label: 'New event',
        action: { kind: 'create_record', objectId: 'ext-events.event' },
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
      moduleId: 'ext-events',
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
    expect((await client.modules.list()).map((e) => e.moduleId).sort()).toEqual(['ext-events', 'fixture']);

    const schema = await client.metadata.getSchema();
    const event = schema.objects.find((o) => o.nameSingular === 'event');
    expect(event?.moduleId).toBe('ext-events');
    expect(schema.fields.filter((f) => f.objectId === event?.id).map((f) => f.name)).toEqual([
      'title',
      'starts_at',
      'company',
    ]);
    const person = schema.objects.find((o) => o.nameSingular === 'person');
    expect(schema.fields.find((f) => f.id === 'ext-events.person.birthday')).toMatchObject({
      objectId: person?.id,
      moduleId: 'ext-events',
      type: 'date',
      position: 20,
    });
    expect(schema.views.find((v) => v.id === 'ext-events.event.all')?.config.fields).toEqual([
      { fieldId: 'ext-events.event.title', visible: true },
      { fieldId: 'ext-events.event.starts_at', visible: true },
      { fieldId: 'ext-events.event.company', visible: true },
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
              id: 'ext-events.event.location',
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
    expect(byId.get('ext-events.event.starts_at')).toMatchObject({
      action: 'update',
      destructive: true,
      diff: { type: { from: 'date_time', to: 'date' }, label: { from: 'Starts at', to: 'Starts on' } },
    });
    expect(byId.get('ext-events.event.location')).toMatchObject({ action: 'create', destructive: false });
    expect(byId.get('ext-events.events')).toMatchObject({ action: 'delete', destructive: false });
    expect(byId.get('ext-events.event')?.action).toBe('noop');

    const refused = await failure(client.modules.apply(v2));
    expect(refused.status).toBe(409);
    expect(refused.code).toBe('DESTRUCTIVE_CHANGE');
    const mismatch = await failure(client.modules.apply(v2, { allowDestructive: true, expectedPlanHash: 'stale' }));
    expect(mismatch.code).toBe('PLAN_MISMATCH');

    const result = await client.modules.apply(v2, { allowDestructive: true, expectedPlanHash: plan.planHash });
    expect(result.version).toBe('1.1.0');
    expect(result.applied.map((c) => c.action).sort()).toEqual(['create', 'delete', 'update']);
    const schema = await client.metadata.getSchema();
    expect(schema.fields.find((f) => f.id === 'ext-events.event.starts_at')?.type).toBe('date');
    expect(schema.fields.some((f) => f.id === 'ext-events.event.location')).toBe(true);
    expect(schema.navItems.some((n) => n.id === 'ext-events.events')).toBe(false);
    expect((await client.modules.list()).find((e) => e.moduleId === 'ext-events')?.version).toBe('1.1.0');
  });

  it('reports conflicts and missing dependencies instead of touching foreign rows', async () => {
    const client = demo();
    const clash = parseManifest({
      id: 'ext-clash',
      version: '1.0.0',
      fields: [
        {
          id: 'ext-clash.person.email',
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
      id: 'ext-dangling',
      version: '1.0.0',
      views: [{ id: 'ext-dangling.x.x', objectId: 'nobody.x', label: 'X' }],
    });
    const missing = await failure(client.modules.apply(dangling));
    expect(missing.status).toBe(422);
    expect(missing.code).toBe('MISSING_DEPENDENCY');

    expect((await client.modules.list()).map((e) => e.moduleId)).toEqual(['fixture']);
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
    const view = (await client.metadata.views.list()).find((v) => v.id === 'ext-events.event.all');
    expect(view?.config.fields.map((f) => f.fieldId)).toEqual([
      'ext-events.event.title',
      'ext-events.event.starts_at',
      'ext-events.event.company',
    ]);

    const refused = await failure(client.modules.uninstall('ext-events'));
    expect(refused.code).toBe('DESTRUCTIVE_CHANGE');
    const result = await client.modules.uninstall('ext-events', { allowDestructive: true });
    expect(result.moduleId).toBe('ext-events');
    expect(result.applied.some((c) => c.kind === 'object' && c.action === 'delete')).toBe(true);
    expect(result.applied.find((c) => c.id === custom.id)).toMatchObject({
      action: 'delete',
      reason: expect.stringContaining('Cascade'),
    });

    const schema = await client.metadata.getSchema();
    expect(schema.modules.map((e) => e.moduleId)).toEqual(['fixture']);
    expect(schema.objects.map((o) => o.nameSingular).sort()).toEqual([
      'chore',
      'company',
      'note',
      'opportunity',
      'person',
    ]);
    expect(schema.fields).toHaveLength(33);
    expect(schema.navItems.find((n) => n.id === customNav.id)).toBeDefined();
    expect(schema.navItems.some((n) => n.id === 'ext-events.events')).toBe(false);
    expect((await failure(client.records.get('event', 'x'))).code).toBe('NOT_FOUND');
    expect((await failure(client.modules.uninstall('ext-events'))).code).toBe('NOT_FOUND');

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

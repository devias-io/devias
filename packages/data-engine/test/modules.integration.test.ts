import { hashManifest, type ObjectMetadata, parseManifest, primaryFieldOf } from '@devias/core';
import { manifest as fixture, ids } from '@devias/fixtures';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDataEngine, EngineError, silentLogger } from '../src';
import { createTestDb, createTestEngine, type TestEngine } from './helpers/db';

const codeOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;

    return 'ok';
  } catch (error) {
    if (error instanceof EngineError) {
      return error.code;
    }

    throw error;
  }
};

describe('modules on PGlite', () => {
  let t: TestEngine;
  beforeAll(async () => {
    t = await createTestEngine({ seed: false });
  });
  afterAll(() => t.close());

  it('plans and applies fixture, then re-plans as all noop (idempotent)', async () => {
    const plan = await t.engine.modules.plan(t.owner, fixture);
    expect(plan.fromVersion).toBeNull();
    expect(plan.hasConflicts).toBe(false);
    expect(plan.hasDestructive).toBe(false);
    expect(plan.changes.every((c) => c.action === 'create')).toBe(true);
    expect(plan.changes.filter((c) => c.kind === 'object')).toHaveLength(5);

    expect(await codeOf(t.engine.modules.apply(t.owner, fixture, { expectedPlanHash: 'stale' }))).toBe('PLAN_MISMATCH');
    const result = await t.engine.modules.apply(t.owner, fixture, { expectedPlanHash: plan.planHash });
    expect(result.applied).toHaveLength(plan.changes.length);
    expect(result.manifestHash).toBe(hashManifest(fixture));

    const again = await t.engine.modules.plan(t.owner, fixture);
    expect(again.fromVersion).toBe('0.2.0');
    expect(again.changes.every((c) => c.action === 'noop')).toBe(true);
    const noop = await t.engine.modules.apply(t.owner, fixture);
    expect(noop.applied).toEqual([]);

    const schema = await t.engine.metadata.getSchema(t.owner);
    expect(schema.modules).toEqual([expect.objectContaining({ moduleId: 'fixture', version: '0.2.0' })]);
    const person = schema.objects.find((o) => o.id === ids.objects.person);
    expect(person?.moduleId).toBe('fixture');
    expect(schema.fields.filter((f) => f.objectId === person?.id).map((f) => f.name)).toEqual([
      'first_name',
      'last_name',
      'email',
      'phone',
      'job_title',
      'company',
      'city',
      'linkedin',
    ]);
    const pipeline = schema.views.find((v) => v.id === ids.views.opportunity.pipeline);
    expect(pipeline?.config.groupById).toBe(ids.fields.opportunity.stage);
    // Sub menus: three headings with a destination of none, and the rows nested under them by parent id.
    expect(schema.navItems).toHaveLength(9);
    const heading = (label: string) => schema.navItems.find((n) => n.label === label);
    expect(heading('Contacts')?.target).toEqual({ kind: 'group' });
    const under = (label: string) =>
      schema.navItems
        .filter((n) => n.parentId === heading(label)?.id)
        .sort((x, y) => x.position - y.position)
        .map((n) => n.label);
    expect(under('Contacts')).toEqual(['People', 'Companies']);
    expect(under('Sales')).toEqual(['Pipeline', 'Opportunities']);
    expect(under('Activity')).toEqual(['Chores', 'Notes']);
    expect(schema.commandItems).toHaveLength(3);
    const events = await t.engine.events.list(t.owner, { after: 0 });
    expect(events.map((e) => e.type)).toEqual(['module.applied']);
  });

  it('upgrades: updates, creates and destructive deletes gated by allowDestructive', async () => {
    const company = await t.engine.records.create(t.owner, 'company', { name: 'Acme' });
    expect(company.name).toBe('Acme');
    const v2 = parseManifest({
      ...fixture,
      version: '0.2.0',
      objects: fixture.objects
        .filter((o) => o.id !== ids.objects.note)
        .map((o) =>
          o.id === ids.objects.company
            ? {
                ...o,
                labelPlural: 'Organisations',
                fields: o.fields.filter((f) => f.id !== ids.fields.company.city),
              }
            : o,
        ),
      views: fixture.views
        .filter((v) => v.objectId !== ids.objects.note)
        // The field that goes is no column of the company list any more.
        .map((v) =>
          v.objectId === ids.objects.company
            ? { ...v, fields: v.fields?.filter((f) => f.fieldId !== ids.fields.company.city) }
            : v,
        ),
      navItems: [
        ...fixture.navItems.filter((n) => n.id !== ids.nav.notes),
        { id: 'fixture.reports', label: 'Reports', target: { kind: 'url', url: '/reports' } },
      ],
      layouts: fixture.layouts,
    });
    const plan = await t.engine.modules.plan(t.owner, v2);
    const byId = (uid: string) => plan.changes.find((c) => c.id === uid);
    expect(byId(ids.objects.company)?.action).toBe('update');
    expect(byId(ids.objects.company)?.diff).toEqual({ labelPlural: { from: 'Companies', to: 'Organisations' } });
    expect(byId(ids.objects.note)?.action).toBe('delete');
    expect(byId(ids.objects.note)?.reason).toContain('0 record(s)');
    expect(byId(ids.fields.company.city)?.action).toBe('delete');
    expect(byId('fixture.reports')?.action).toBe('create');
    expect(plan.hasDestructive).toBe(true);
    expect(await codeOf(t.engine.modules.apply(t.owner, v2))).toBe('DESTRUCTIVE_CHANGE');
    const applied = await t.engine.modules.apply(t.owner, v2, { allowDestructive: true });
    expect(applied.version).toBe('0.2.0');
    const schema = await t.engine.metadata.getSchema(t.owner);
    expect(schema.objects.map((o) => o.nameSingular).sort()).toEqual(['chore', 'company', 'opportunity', 'person']);
    expect(schema.fields.some((f) => f.id === ids.fields.company.city)).toBe(false);
    expect(schema.views.some((v) => v.objectId === schema.objects.find((o) => o.nameSingular === 'note')?.id)).toBe(
      false,
    );
    expect((await t.engine.modules.plan(t.owner, v2)).changes.every((c) => c.action === 'noop')).toBe(true);
    const fetched = await t.engine.records.get(t.owner, 'company', company.id);
    expect('city' in fetched).toBe(false);
  });

  it('refuses conflicts with workspace-owned rows and reports missing dependencies', async () => {
    const schema = await t.engine.metadata.getSchema(t.owner);
    const person = schema.objects.find((o) => o.nameSingular === 'person');

    if (!person) {
      throw new Error('person');
    }

    await t.engine.metadata.fields.create(t.owner, {
      objectId: person.id,
      name: 'nickname',
      type: 'text',
      label: 'Nickname',
    });
    const clash = parseManifest({
      id: 'other',
      version: '1.0.0',
      fields: [
        {
          id: 'other.person.nickname',
          objectId: ids.objects.person,
          name: 'nickname',
          label: 'Nick',
          type: 'text',
        },
      ],
    });
    const plan = await t.engine.modules.plan(t.owner, clash);
    expect(plan.hasConflicts).toBe(true);
    expect(await codeOf(t.engine.modules.apply(t.owner, clash))).toBe('CONFLICT');
    const missing = parseManifest({
      id: 'other',
      version: '1.0.0',
      views: [{ id: 'other.x.ghost', objectId: 'ghost.x', label: 'Ghost' }],
    });
    expect(await codeOf(t.engine.modules.plan(t.owner, missing))).toBe('MISSING_DEPENDENCY');
    expect(await codeOf(t.engine.modules.plan(t.owner, { id: 'bad id!', version: 'x' }))).toBe('VALIDATION');
    expect(await codeOf(t.engine.modules.plan(t.member, clash))).toBe('FORBIDDEN');
  });

  it('installs a second module that extends fixture objects and uninstalls it cleanly', async () => {
    const ext = parseManifest({
      id: 'scoring',
      version: '1.0.0',
      fields: [
        {
          id: 'scoring.person.score',
          objectId: ids.objects.person,
          name: 'score',
          label: 'Score',
          type: 'number',
        },
      ],
      views: [
        {
          id: 'scoring.person.scored',
          objectId: ids.objects.person,
          label: 'Scored',
          fields: [{ fieldId: ids.fields.person.first_name }, { fieldId: 'scoring.person.score' }],
          sorts: [{ fieldId: 'scoring.person.score', direction: 'desc' }],
        },
      ],
    });
    await t.engine.modules.apply(t.owner, ext);
    const person = await t.engine.records.create(t.owner, 'person', { first_name: 'Scored', score: 9 });
    expect(person.score).toBe(9);
    expect((await t.engine.modules.list(t.owner)).map((e) => e.moduleId).sort()).toEqual(['fixture', 'scoring']);

    const plan = await t.engine.modules.plan(t.owner, { id: 'scoring', version: '0.0.0' });
    expect(plan.changes.map((c) => [c.kind, c.action])).toEqual([
      ['view', 'delete'],
      ['field', 'delete'],
    ]);
    expect(await codeOf(t.engine.modules.uninstall(t.owner, 'scoring'))).toBe('DESTRUCTIVE_CHANGE');
    const result = await t.engine.modules.uninstall(t.owner, 'scoring', { allowDestructive: true });
    expect(result.applied).toHaveLength(2);
    const schema = await t.engine.metadata.getSchema(t.owner);
    expect(schema.modules.map((e) => e.moduleId)).toEqual(['fixture']);
    expect(schema.fields.some((f) => f.name === 'score')).toBe(false);
    const after = await t.engine.records.get(t.owner, 'person', person.id);
    expect('score' in after).toBe(false);
  });

  it('keeps a module with its publisher, engines and policies', async () => {
    const audit = parseManifest({
      id: 'audit',
      version: '1.0.0',
      publisher: { id: 'acme', name: 'Acme' },
      engines: { devias: '>=0.1' },
      policies: [
        {
          id: 'audit.flags',
          description: 'Flagging needs review.',
          match: { objectId: ids.objects.person },
          decision: 'review',
        },
      ],
    });
    await t.engine.modules.plan(t.owner, audit);
    await t.engine.modules.apply(t.owner, audit);
    const installed = (await t.engine.modules.list(t.owner)).find((e) => e.moduleId === 'audit');
    expect(installed).toMatchObject({
      publisher: { id: 'acme', name: 'Acme' },
      engines: { devias: '>=0.1' },
      policies: [{ id: 'audit.flags', decision: 'review' }],
    });
    await t.engine.modules.uninstall(t.owner, 'audit');
  });
});

describe('metadata CRUD on PGlite', () => {
  let t: TestEngine;
  beforeAll(async () => {
    t = await createTestEngine();
  });
  afterAll(() => t.close());

  it('creates workspace-owned objects and fields with validation, bumping the version and emitting events', async () => {
    const before = await t.engine.metadata.getSchema(t.owner);
    const start = await t.engine.events.currentSequence(t.workspaceId);
    const object = await t.engine.metadata.objects.create(t.owner, {
      nameSingular: 'ticket',
      namePlural: 'tickets',
      labelSingular: 'Ticket',
      labelPlural: 'Tickets',
    });
    expect(object.id).toMatch(/^workspace\./);
    expect(object.moduleId).toBeNull();
    expect(
      await codeOf(
        t.engine.metadata.objects.create(t.owner, {
          nameSingular: 'ticket',
          namePlural: 'x',
          labelSingular: 'X',
          labelPlural: 'X',
        }),
      ),
    ).toBe('CONFLICT');
    expect(
      await codeOf(
        t.engine.metadata.objects.create(t.owner, {
          nameSingular: 'Bad Name',
          namePlural: 'x',
          labelSingular: 'X',
          labelPlural: 'X',
        }),
      ),
    ).toBe('VALIDATION');

    const title = await t.engine.metadata.fields.create(t.owner, {
      objectId: object.id,
      name: 'title',
      type: 'text',
      label: 'Title',
      isRequired: true,
    });
    expect(
      await codeOf(
        t.engine.metadata.fields.create(t.owner, { objectId: object.id, name: 'id', type: 'text', label: 'Id' }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        t.engine.metadata.fields.create(t.owner, { objectId: object.id, name: 'title', type: 'text', label: 'Dup' }),
      ),
    ).toBe('CONFLICT');
    expect(
      await codeOf(
        t.engine.metadata.fields.create(t.owner, {
          objectId: object.id,
          name: 'prio',
          type: 'select',
          label: 'Prio',
          settings: { options: [] },
        }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        t.engine.metadata.fields.create(t.owner, {
          objectId: object.id,
          name: 'owner',
          type: 'relation',
          label: 'Owner',
          settings: { relationType: 'many_to_one', targetObjectId: 'nope.x' },
        }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        t.engine.metadata.fields.create(t.member, { objectId: object.id, name: 'x', type: 'text', label: 'X' }),
      ),
    ).toBe('FORBIDDEN');
    const person = await t.engine.metadata.fields.create(t.owner, {
      objectId: object.id,
      name: 'requester',
      type: 'relation',
      label: 'Requester',
      settings: { relationType: 'many_to_one', targetObjectId: 'fixture.person' },
    });
    expect(person.settings.targetObjectId).toBe('fixture.person');

    const after = await t.engine.metadata.getSchema(t.owner);
    expect(after.version).toBe(before.version + 3);
    const events = await t.engine.events.list(t.owner, { after: start });
    expect(events.map((e) => e.type === 'metadata.changed' && e.entity)).toEqual(['object', 'field', 'field']);

    const ticket = await t.engine.records.create(t.owner, 'ticket', { title: 'Broken' });
    expect(ticket.requester).toBeNull();
    await t.engine.metadata.fields.update(t.owner, title.id, { name: 'subject' });
    const renamed = await t.engine.records.get(t.owner, 'ticket', ticket.id);
    expect(renamed.subject).toBe('Broken');
    expect('title' in renamed).toBe(false);
  });

  it('points an object at its primary field by id, once the field exists, and keeps the field while it is the primary one', async () => {
    const object = await t.engine.metadata.objects.create(t.owner, {
      nameSingular: 'deal_note',
      namePlural: 'deal_notes',
      labelSingular: 'Deal note',
      labelPlural: 'Deal notes',
    });
    expect(
      await codeOf(
        t.engine.metadata.objects.create(t.owner, {
          nameSingular: 'early',
          namePlural: 'earlies',
          labelSingular: 'Early',
          labelPlural: 'Earlies',
          primaryFieldId: 'workspace.0198f1c6-0000-7000-8000-000000000000',
        }),
      ),
    ).toBe('VALIDATION');

    const title = await t.engine.metadata.fields.create(t.owner, {
      objectId: object.id,
      name: 'headline',
      type: 'text',
      label: 'Headline',
    });
    expect(
      await codeOf(t.engine.metadata.objects.update(t.owner, object.id, { primaryFieldId: 'workspace.nothing' })),
    ).toBe('VALIDATION');
    const named = await t.engine.metadata.objects.update(t.owner, object.id, { primaryFieldId: title.id });
    expect(named.primaryFieldId).toBe(title.id);

    // A rename of the field's API name leaves the pointer alone: it holds the id.
    await t.engine.metadata.fields.update(t.owner, title.id, { name: 'title' });
    const { index } = await t.engine.metadata.getSnapshot(t.workspaceId);
    expect(primaryFieldOf(index, index.objectsById.get(object.id) as ObjectMetadata)?.name).toBe('title');

    expect(await codeOf(t.engine.metadata.fields.delete(t.owner, title.id))).toBe('VALIDATION');
    await t.engine.metadata.objects.update(t.owner, object.id, { primaryFieldId: undefined });
    expect(await codeOf(t.engine.metadata.fields.delete(t.owner, title.id))).toBe('ok');
  });

  it('gates destructive field changes, rebuilds uniqueness and deletes objects with their records', async () => {
    const schema = await t.engine.metadata.getSchema(t.owner);
    const object = schema.objects.find((o) => o.nameSingular === 'ticket');
    const subject = schema.fields.find((f) => f.objectId === object?.id && f.name === 'subject');

    if (!object || !subject) {
      throw new Error('fixture');
    }

    await t.engine.records.create(t.owner, 'ticket', { subject: 'Broken' });
    expect(await codeOf(t.engine.metadata.fields.update(t.owner, subject.id, { isUnique: true }))).toBe(
      'UNIQUE_VIOLATION',
    );
    expect(await codeOf(t.engine.metadata.fields.update(t.owner, subject.id, { type: 'number' }))).toBe(
      'DESTRUCTIVE_CHANGE',
    );
    const asEmail = await t.engine.metadata.fields.update(t.owner, subject.id, { type: 'phone' });
    expect(asEmail.type).toBe('phone');
    const page = await t.engine.records.list(t.owner, { object: 'ticket', count: true });
    expect(page.totalCount).toBe(2);
    await t.engine.metadata.objects.delete(t.owner, object.id);
    expect(await codeOf(t.engine.records.list(t.owner, { object: 'ticket' }))).toBe('NOT_FOUND');
    expect((await t.engine.metadata.getSchema(t.owner)).fields.some((f) => f.objectId === object.id)).toBe(false);
  });

  it('manages views, layouts, nav and command items with reference validation', async () => {
    const schema = await t.engine.metadata.getSchema(t.owner);
    const person = schema.objects.find((o) => o.nameSingular === 'person');

    if (!person) {
      throw new Error('person');
    }

    expect(
      await codeOf(
        t.engine.metadata.views.create(t.owner, {
          objectId: person.id,
          label: 'Bad',
          type: 'table',
          config: { fields: [{ fieldId: 'ghost', visible: true }] },
        }),
      ),
    ).toBe('VALIDATION');
    const view = await t.engine.metadata.views.create(t.owner, {
      objectId: person.id,
      label: 'By city',
      type: 'table',
      config: {
        fields: [
          { fieldId: 'first_name', visible: true },
          { fieldId: 'city', visible: true },
        ],
        sorts: [{ fieldId: 'city', direction: 'asc' }],
      },
    });
    // The agent and the API may name a field by its API name: the view stores its id.
    expect(view.config.fields[0]).toEqual({ fieldId: ids.fields.person.first_name, visible: true });
    const updated = await t.engine.metadata.views.update(t.owner, view.id, { config: { groupById: 'city' } });
    expect(updated.config.groupById).toBe(ids.fields.person.city);
    expect(updated.config.fields).toHaveLength(2);
    // JSON clients cannot send `undefined`: null clears a merged config key.
    const filtered = await t.engine.metadata.views.update(t.owner, view.id, {
      config: { filter: { field: 'city', op: 'is_not_empty' } },
    });
    expect(filtered.config.filter).toEqual({ field: ids.fields.person.city, op: 'is_not_empty' });
    const cleared = await t.engine.metadata.views.update(t.owner, view.id, {
      config: { filter: null, groupById: null },
    });
    expect(cleared.config.filter).toBeUndefined();
    expect(cleared.config.groupById).toBeUndefined();
    expect(cleared.config.sorts).toEqual([{ fieldId: ids.fields.person.city, direction: 'asc' }]);
    const layout = await t.engine.metadata.layouts.create(t.owner, {
      objectId: person.id,
      label: 'Compact',
      shell: 'tabs',
      tabs: [
        {
          name: 'main',
          label: 'Main',
          blocks: [{ name: 'f', blockId: 'core.fields', config: { fieldIds: ['first_name'] } }],
        },
      ],
    });
    expect(layout.kind).toBe('record');
    expect(layout.shell).toBe('tabs');
    // A shape holds exactly its own keys: changing it brings the new shape's content, and the old one's goes.
    const documentBlocks = [{ name: 'f', blockId: 'core.fields', config: {} }];
    const shaped = await t.engine.metadata.layouts.update(t.owner, layout.id, {
      shell: 'column',
      blocks: documentBlocks,
    });
    expect(shaped.shell).toBe('column');
    expect(shaped.shell === 'column' ? shaped.blocks.map((cell) => cell.name) : []).toEqual(['f']);
    expect('tabs' in shaped).toBe(false);
    expect((await t.engine.metadata.layouts.get(t.owner, layout.id)).shell).toBe('column');
    // Without its content, or with another shape's, it is refused with a message that says what to change.
    expect(await codeOf(t.engine.metadata.layouts.update(t.owner, layout.id, { shell: 'split' }))).toBe('VALIDATION');
    expect(
      await codeOf(
        t.engine.metadata.layouts.update(t.owner, layout.id, { tabs: [{ name: 'a', label: 'A', blocks: [] }] }),
      ),
    ).toBe('VALIDATION');
    expect(await codeOf(t.engine.metadata.layouts.update(t.owner, layout.id, { aside: documentBlocks }))).toBe(
      'VALIDATION',
    );
    // `split` has a main column and an aside.
    const split = await t.engine.metadata.layouts.update(t.owner, layout.id, {
      shell: 'split',
      main: documentBlocks,
      aside: documentBlocks.map((cell) => ({ ...cell, name: 'g' })),
    });
    expect(split.shell).toBe('split');
    expect(split.shell === 'split' ? [split.main.length, split.aside.length] : []).toEqual([1, 1]);
    const parent = await t.engine.metadata.navItems.create(t.owner, {
      label: 'Sales',
      target: { kind: 'object', objectId: ids.objects.person },
    });
    const child = await t.engine.metadata.navItems.create(t.owner, {
      label: 'People',
      target: { kind: 'object', objectId: ids.objects.person },
      parentId: parent.id,
    });
    expect(child.parentId).toBe(parent.id);
    expect(
      await codeOf(
        t.engine.metadata.navItems.create(t.owner, {
          label: 'Orphan',
          target: { kind: 'url', url: '/x' },
          parentId: '019965a0-0000-7000-8000-00000000dead',
        }),
      ),
    ).toBe('VALIDATION');
    const command = await t.engine.metadata.commandItems.create(t.owner, {
      label: 'New ticket',
      group: 'Create',
      action: { kind: 'create_record', objectId: ids.objects.person },
    });
    expect(command.group).toBe('Create');
    await t.engine.metadata.commandItems.delete(t.owner, command.id);
    await t.engine.metadata.navItems.delete(t.owner, parent.id);
    const after = await t.engine.metadata.getSchema(t.owner);
    expect(after.navItems.find((n) => n.id === child.id)?.parentId).toBeNull();
    expect(after.commandItems.some((c) => c.id === command.id)).toBe(false);
    expect(await codeOf(t.engine.metadata.views.get(t.owner, 'nope'))).toBe('NOT_FOUND');
    expect(
      await codeOf(
        t.engine.metadata.getSchema({ workspaceId: t.workspaceId, actor: { kind: 'user', id: 'x' }, role: null }),
      ),
    ).toBe('FORBIDDEN');
  });

  it('drops the nav items and command items that point at a deleted object', async () => {
    const object = await t.engine.metadata.objects.create(t.owner, {
      nameSingular: 'invoice',
      namePlural: 'invoices',
      labelSingular: 'Invoice',
      labelPlural: 'Invoices',
    });
    const nav = (label: string, objectId: string) =>
      t.engine.metadata.navItems.create(t.owner, { label, target: { kind: 'object', objectId } });
    const byId = await nav('All invoices', object.id);
    const unrelated = await nav('Everyone', ids.objects.person);
    const create = await t.engine.metadata.commandItems.create(t.owner, {
      label: 'New invoice',
      action: { kind: 'create_record', objectId: object.id },
    });
    const open = await t.engine.metadata.commandItems.create(t.owner, {
      label: 'Open invoices',
      action: { kind: 'navigate', target: { kind: 'object', objectId: object.id } },
    });

    await t.engine.metadata.objects.delete(t.owner, object.id);
    const schema = await t.engine.metadata.getSchema(t.owner);
    const navIds = schema.navItems.map((n) => n.id);
    expect(navIds).not.toContain(byId.id);
    expect(navIds).toContain(unrelated.id);
    const commandIds = schema.commandItems.map((c) => c.id);
    expect(commandIds).not.toContain(create.id);
    expect(commandIds).not.toContain(open.id);
    await t.engine.metadata.navItems.delete(t.owner, unrelated.id);
  });

  it('takes an object by name where an objectId is asked for, and answers bad ids with clean errors', async () => {
    const schema = await t.engine.metadata.getSchema(t.owner);
    const person = schema.objects.find((o) => o.nameSingular === 'person');

    if (!person) {
      throw new Error('fixture');
    }

    // The agent names objects; "person", "people" and the id all resolve to the row id.
    const view = await t.engine.metadata.views.create(t.owner, { objectId: 'person', label: 'By name', type: 'table' });
    expect(view.objectId).toBe(person.id);
    const layout = await t.engine.metadata.layouts.create(t.owner, {
      objectId: 'people',
      label: 'By plural',
      shell: 'tabs',
      tabs: [],
    });
    expect(layout.objectId).toBe(person.id);
    const field = await t.engine.metadata.fields.create(t.owner, {
      objectId: person.id,
      name: 'nickname',
      label: 'Nickname',
      type: 'text',
    });
    expect(field.objectId).toBe(person.id);
    // Unknown objects are NOT_FOUND, and a name where a uuid belongs is VALIDATION, not a failed query.
    expect(
      await codeOf(
        t.engine.metadata.layouts.create(t.owner, { objectId: 'customer', label: 'X', shell: 'tabs', tabs: [] }),
      ),
    ).toBe('NOT_FOUND');
    expect(
      await codeOf(
        t.engine.metadata.navItems.create(t.owner, {
          label: 'Child',
          target: { kind: 'url', url: '/x' },
          parentId: 'Sales',
        }),
      ),
    ).toBe('VALIDATION');
    await t.engine.metadata.fields.delete(t.owner, field.id);
    await t.engine.metadata.layouts.delete(t.owner, layout.id);
    await t.engine.metadata.views.delete(t.owner, view.id);
  });

  it('refuses layout cells that name a block that cannot exist', async () => {
    const tabs = (block: string) => [
      { name: 'main', label: 'Overview', blocks: [{ name: 'cell', blockId: block, config: {} }] },
    ];
    const create = (block: string) =>
      t.engine.metadata.layouts.create(t.owner, {
        objectId: 'person',
        label: 'Probe',
        shell: 'tabs',
        tabs: tabs(block),
      });
    const messageOf = async (promise: Promise<unknown>) => {
      try {
        await promise;

        return 'ok';
      } catch (error) {
        return error instanceof EngineError ? `${error.code}: ${error.message}` : String(error);
      }
    };
    // A guessed id is refused with the real names, so the agent can correct itself.
    expect(await messageOf(create('core.record-fields'))).toMatch(/^VALIDATION: .*core\.fields/);
    expect(await messageOf(create('studio.summary'))).toMatch(
      /^VALIDATION: Tab "Overview", cell "cell": Unknown block/,
    );
    expect(await messageOf(create('banking.summary'))).toMatch(/^VALIDATION: .*Unknown block "banking\.summary"/);
    // A declared block that only renders on Home is not a record block.
    expect(await messageOf(create('fixture.pipeline'))).toMatch(/does not render on record pages/);
    // An optional cell may name a block no installed module declares: the page leaves it out.
    const optional = await t.engine.metadata.layouts.create(t.owner, {
      objectId: 'person',
      label: 'Optional',
      shell: 'tabs',
      tabs: [
        {
          name: 'main',
          label: 'Overview',
          blocks: [{ name: 'cell', blockId: 'banking.summary', config: {}, optional: true }],
        },
      ],
    });
    expect(optional.shell === 'tabs' ? optional.tabs[0]?.blocks[0]?.optional : undefined).toBe(true);
    await t.engine.metadata.layouts.delete(t.owner, optional.id);
    // The studio's blocks and the record blocks an installed module declares are fine.
    const layout = await create('core.fields');
    const updated = await t.engine.metadata.layouts.update(t.owner, layout.id, {
      tabs: tabs('fixture.person_summary'),
    });
    expect(updated.shell === 'tabs' ? updated.tabs[0]?.blocks[0]?.blockId : undefined).toBe('fixture.person_summary');
    expect(await codeOf(t.engine.metadata.layouts.update(t.owner, layout.id, { tabs: tabs('core.x') }))).toBe(
      'VALIDATION',
    );
    // The header is checked like the tabs, and kept beside them.
    const cell = (block: string) => ({ name: 'side', blockId: block, config: {} });
    expect(await messageOf(t.engine.metadata.layouts.update(t.owner, layout.id, { header: cell('core.x') }))).toMatch(
      /^VALIDATION: Header, cell "side": Unknown block/,
    );
    const headed = await t.engine.metadata.layouts.update(t.owner, layout.id, {
      header: cell('core.fields'),
    });
    expect(headed.shell === 'tabs' ? headed.header?.blockId : undefined).toBe('core.fields');
    expect(headed.shell === 'tabs' ? headed.tabs[0]?.blocks[0]?.blockId : undefined).toBe('fixture.person_summary');
    const stored = await t.engine.metadata.layouts.get(t.owner, layout.id);
    expect(stored.shell === 'tabs' ? stored.header : undefined).toBeDefined();
    const plain = await create('core.fields');
    expect(plain.shell === 'tabs' ? plain.header : 'not tabs').toBeUndefined();
    // The module actions the page offers: none by default, a list is exactly what shows, and each one must exist.
    expect(headed.actions).toEqual([]);
    expect((await t.engine.metadata.layouts.update(t.owner, layout.id, { actions: [] })).actions).toEqual([]);
    expect(
      await messageOf(t.engine.metadata.layouts.update(t.owner, layout.id, { actions: [{ actionId: 'books.sync' }] })),
    ).toMatch(/^VALIDATION: Actions: "books\.sync" is not an action of an installed module/);
    // A manifest's layouts are checked when it is planned: its own blocks must be declared, others installed.
    const layoutWith = (block: string) => ({
      id: 'ext.person.default',
      objectId: ids.objects.person,
      label: 'Ext',
      shell: 'tabs' as const,
      header: { name: 'side', blockId: 'core.fields', config: {} },
      tabs: [{ name: 'main', label: 'Main', blocks: [{ name: 'cell', blockId: block, config: {} }] }],
    });
    const ext = (block: string, declared: boolean) =>
      parseManifest({
        id: 'ext',
        version: '1.0.0',
        layouts: [layoutWith(block)],
        blocks: declared ? [{ id: 'ext.card', label: 'Card', surfaces: ['record'] }] : [],
      });
    // Its own block must be declared: the manifest is refused before it can be planned.
    expect(() => ext('ext.card', false)).toThrow('points at the block "ext.card", which it does not declare');
    expect((await t.engine.modules.plan(t.owner, ext('ext.card', true))).hasConflicts).toBe(false);
    expect((await t.engine.modules.plan(t.owner, ext('fixture.person_summary', false))).hasConflicts).toBe(false);
    await t.engine.metadata.layouts.delete(t.owner, layout.id);
  });

  it('applies a module layout with its shape, and follows the module when the shape changes', async () => {
    const cells = [{ name: 'f', blockId: 'core.fields', config: {} }];
    const shaped = (shell: 'column' | 'tabs') =>
      parseManifest({
        id: 'shaper',
        version: shell === 'column' ? '1.0.0' : '1.1.0',
        layouts: [
          shell === 'column'
            ? { id: 'shaper.person.default', objectId: ids.objects.person, label: 'Page', shell, blocks: cells }
            : {
                id: 'shaper.person.default',
                objectId: ids.objects.person,
                label: 'Page',
                shell,
                tabs: [{ name: 'page', label: 'Page', blocks: cells }],
              },
        ],
      });
    await t.engine.modules.apply(t.owner, shaped('column'));
    const find = async () =>
      (await t.engine.metadata.getSchema(t.owner)).layouts.find((l) => l.id === 'shaper.person.default');
    expect((await find())?.shell).toBe('column');
    const plan = await t.engine.modules.plan(t.owner, shaped('tabs'));
    expect(plan.changes.filter((c) => c.kind === 'layout').map((c) => c.action)).toEqual(['update']);
    await t.engine.modules.apply(t.owner, shaped('tabs'));
    const after = await find();
    expect(after?.shell).toBe('tabs');
    expect(after && 'blocks' in after).toBe(false);
    // The same module again changes nothing.
    expect((await t.engine.modules.plan(t.owner, shaped('tabs'))).changes.every((c) => c.action === 'noop')).toBe(true);
  });
});

describe('seed manifests across restarts', () => {
  const kernel = parseManifest({ id: 'kernel', version: '0.0.0', core: true });
  const workspaceId = 'ws_seed';
  const owner = { workspaceId, actor: { kind: 'user' as const, id: 'u_owner' }, role: 'owner' as const };
  const installedIds = async (engine: ReturnType<typeof createDataEngine>) =>
    (await engine.modules.list(owner)).map((m) => m.moduleId).sort();

  it('installs the starting set once, keeps core modules, and lets an uninstall stick', async () => {
    const db = await createTestDb();
    // Each engine is a server process: initialization is memoized per process, not per database.
    const boot = (seedManifests = [kernel, fixture]) =>
      createDataEngine({ db: db.db, logger: silentLogger, seedManifests });

    try {
      // A workspace created before the core module existed gets it on the next start.
      const first = boot([fixture]);
      await first.workspaces.initialize(workspaceId);
      expect(await installedIds(first)).toEqual(['fixture']);
      await first.close();

      const second = boot();
      await second.workspaces.initialize(workspaceId);
      expect(await installedIds(second)).toEqual(['fixture', 'kernel']);
      await second.modules.uninstall(owner, 'fixture', { allowDestructive: true });
      expect(await codeOf(second.modules.uninstall(owner, 'kernel'))).toBe('CONFLICT');
      await second.close();

      const third = boot();
      await third.workspaces.initialize(workspaceId);
      expect(await installedIds(third)).toEqual(['kernel']);
      await third.close();
    } finally {
      await db.close();
    }
  });
});

describe('a core module whose names clash with the workspace', () => {
  const workspaceId = 'ws_clash';
  // The fixture owns an object named "note"; this core module now wants the same name under its own id.
  const notes = parseManifest({
    id: 'notes',
    version: '0.1.0',
    core: true,
    objects: [
      {
        id: 'notes.note',
        nameSingular: 'note',
        namePlural: 'notes',
        labelSingular: 'Note',
        labelPlural: 'Notes',
        fields: [],
      },
    ],
  });

  it('loads the workspace without it instead of failing to load', async () => {
    const db = await createTestDb();
    const boot = (seedManifests: (typeof fixture)[]) =>
      createDataEngine({ db: db.db, logger: silentLogger, seedManifests });

    try {
      const first = boot([fixture]);
      await first.workspaces.initialize(workspaceId);
      await first.close();

      const second = boot([fixture, notes]);
      await second.workspaces.initialize(workspaceId);
      const owner = { workspaceId, actor: { kind: 'user' as const, id: 'u_owner' }, role: 'owner' as const };
      expect((await second.modules.list(owner)).map((m) => m.moduleId)).toEqual(['fixture']);
      await second.close();
    } finally {
      await db.close();
    }
  });
});

describe('nav sub menus on PGlite', () => {
  let t: TestEngine;
  beforeAll(async () => {
    t = await createTestEngine({ seed: false });
  });
  afterAll(() => t.close());

  it('moves a workspace with a flat sidebar to sub menus, in place, and back to flat', async () => {
    // What the module shipped before sections: its rows, none nested.
    const flat = parseManifest({
      ...fixture,
      navItems: fixture.navItems.filter((n) => n.target.kind !== 'group').map(({ parentId: _parent, ...n }) => n),
    });
    await t.engine.modules.apply(t.owner, flat);
    const before = await t.engine.metadata.getSchema(t.owner);
    expect(before.navItems).toHaveLength(6);
    expect(before.navItems.every((n) => n.parentId === null)).toBe(true);
    const rowIds = new Map(before.navItems.map((n) => [n.id, n.id]));

    const plan = await t.engine.modules.plan(t.owner, fixture);
    const actions = (uid: string) => plan.changes.find((c) => c.id === uid)?.action;
    expect(actions(ids.nav.contacts_group)).toBe('create');
    expect(actions(ids.nav.people)).toBe('update');
    expect(plan.changes.find((c) => c.id === ids.nav.people)?.diff).toMatchObject({
      parentId: { to: ids.nav.contacts_group },
    });
    await t.engine.modules.apply(t.owner, fixture);

    const after = await t.engine.metadata.getSchema(t.owner);
    const group = after.navItems.find((n) => n.id === ids.nav.contacts_group);
    const people = after.navItems.find((n) => n.id === ids.nav.people);
    expect(group?.parentId).toBeNull();
    expect(people?.parentId).toBe(group?.id);
    // The row kept its id: only its place moved.
    expect(people?.id).toBe(rowIds.get(ids.nav.people));
    expect((await t.engine.modules.plan(t.owner, fixture)).changes.every((c) => c.action === 'noop')).toBe(true);

    // Back to flat: rows are un-nested and the empty headings go.
    await t.engine.modules.apply(t.owner, flat);
    const flatAgain = await t.engine.metadata.getSchema(t.owner);
    expect(flatAgain.navItems).toHaveLength(6);
    expect(flatAgain.navItems.every((n) => n.parentId === null)).toBe(true);
  });
});

describe('the workspace arranging its sidebar', () => {
  let t: TestEngine;
  beforeAll(async () => {
    t = await createTestEngine({ seed: false });
    await t.engine.modules.apply(t.owner, fixture);
  });
  afterAll(() => t.close());

  const navItems = async () => (await t.engine.metadata.getSchema(t.owner)).navItems;
  const byUid = async (uid: string) => {
    const row = (await navItems()).find((n) => n.id === uid);

    if (!row) {
      throw new Error(`no nav item ${uid}`);
    }

    return row;
  };

  it("keeps a module's values and stores the workspace's edits beside them", async () => {
    const people = await byUid(ids.nav.people);
    const updated = await t.engine.metadata.navItems.update(t.owner, people.id, {
      label: 'Contacts list',
      hidden: true,
    });
    expect(updated.label).toBe('People');
    expect(updated.overrides).toEqual({ label: 'Contacts list', hidden: true });
    // Setting a value back to the module's own drops that override.
    const same = await t.engine.metadata.navItems.update(t.owner, people.id, { label: 'People' });
    expect(same.overrides).toEqual({ hidden: true });
    await t.engine.metadata.navItems.update(t.owner, people.id, { label: 'Everyone' });
  });

  it('survives a module update, which still brings its own changes', async () => {
    const people = await byUid(ids.nav.people);
    expect(people.overrides).toEqual({ label: 'Everyone', hidden: true });
    const renamed = parseManifest({
      ...fixture,
      version: '0.3.0',
      navItems: fixture.navItems.map((n) => (n.id === ids.nav.people ? { ...n, label: 'People (v3)' } : n)),
    });
    // The module's value changes under the workspace's override, and re-planning is quiet.
    const plan = await t.engine.modules.plan(t.owner, renamed);
    expect(plan.changes.find((c) => c.id === ids.nav.people)?.action).toBe('update');
    await t.engine.modules.apply(t.owner, renamed);
    const after = await byUid(ids.nav.people);
    expect(after.label).toBe('People (v3)');
    expect(after.overrides).toEqual({ label: 'Everyone', hidden: true });
    expect((await t.engine.modules.plan(t.owner, renamed)).changes.every((c) => c.action === 'noop')).toBe(true);
    await t.engine.modules.apply(t.owner, fixture);
  });

  it('resets a module item to what the module defines', async () => {
    const people = await byUid(ids.nav.people);
    const reset = await t.engine.metadata.navItems.reset(t.owner, people.id);
    expect(reset.overrides).toBeNull();
  });

  it("moves items between sections in one step, and won't change a module's destination", async () => {
    const companies = await byUid(ids.nav.companies);
    const sales = await byUid(ids.nav.sales_group);
    const contacts = await byUid(ids.nav.contacts_group);
    const arranged = await t.engine.metadata.navItems.arrange(t.owner, [
      { id: companies.id, parentId: sales.id, position: 0 },
    ]);
    const moved = arranged.find((n) => n.id === companies.id);
    expect(moved?.parentId).toBe(contacts.id); // the module's own parent
    expect(moved?.overrides).toEqual({ parentId: sales.id, position: 0 });
    await expect(
      t.engine.metadata.navItems.update(t.owner, companies.id, { target: { kind: 'url', url: '/x' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // A section cannot be put under one of its own rows.
    await expect(
      t.engine.metadata.navItems.update(t.owner, sales.id, { parentId: companies.id }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // And moving back to the module's place leaves nothing to remember.
    const back = await t.engine.metadata.navItems.arrange(t.owner, [
      { id: companies.id, parentId: contacts.id, position: 1 },
    ]);
    expect(back.find((n) => n.id === companies.id)?.overrides).toBeNull();
  });

  it('resets the whole navigation: overrides cleared, own items kept', async () => {
    const people = await byUid(ids.nav.people);
    await t.engine.metadata.navItems.update(t.owner, people.id, { label: 'Everyone', hidden: true });
    const placed = await t.engine.metadata.navItems.create(t.owner, {
      label: 'Automations',
      target: { kind: 'page', pageId: 'studio.workflows' },
    });
    const link = await t.engine.metadata.navItems.create(t.owner, {
      label: 'Handbook',
      target: { kind: 'url', url: 'https://example.com/handbook', external: true },
      hidden: true,
    });

    const left = await t.engine.metadata.navItems.resetAll(t.owner);
    expect(left.every((n) => n.overrides === null)).toBe(true);
    // What the workspace made stays (the page item and the link); the module's rows are as the module defines them.
    expect(left.some((n) => n.id === placed.id)).toBe(true);
    expect(left.some((n) => n.id === link.id)).toBe(true);
    const after = await byUid(ids.nav.people);
    expect(after.label).toBe('People');
    expect(after.overrides).toBeNull();
  });

  it("edits the workspace's own items in place", async () => {
    const created = await t.engine.metadata.navItems.create(t.owner, {
      label: 'Docs',
      target: { kind: 'url', url: 'https://example.com', external: true },
    });
    const edited = await t.engine.metadata.navItems.update(t.owner, created.id, {
      label: 'Handbook',
      target: { kind: 'url', url: 'https://example.com/handbook', external: true },
      hidden: true,
    });
    expect(edited.label).toBe('Handbook');
    expect(edited.target).toEqual({ kind: 'url', url: 'https://example.com/handbook', external: true });
    expect(edited.overrides).toEqual({ hidden: true });
  });
  it('appends nav items without a position, in the order they are declared and modules are added', async () => {
    const make = (id: string, labels: string[]) =>
      parseManifest({
        id,
        version: '0.1.0',
        name: id,
        description: id,
        icon: 'box',
        objects: [],
        navItems: labels.map((label) => ({
          id: `${id}.${label.toLowerCase()}`,
          label,
          target: { kind: 'url' as const, url: `/${label.toLowerCase()}` },
        })),
      });
    const first = make('ordered-a', ['Alpha', 'Beta']);
    const second = make('ordered-b', ['Gamma']);
    await t.engine.modules.apply(t.owner, first);
    await t.engine.modules.apply(t.owner, second);
    const schema = await t.engine.metadata.getSchema(t.owner);
    const rows = schema.navItems.filter((n) => ['Alpha', 'Beta', 'Gamma'].includes(n.label));
    expect(rows.sort((a, b) => a.position - b.position).map((n) => n.label)).toEqual(['Alpha', 'Beta', 'Gamma']);
    const others = schema.navItems.filter((n) => !rows.includes(n) && n.parentId === null);
    const last = Math.max(...others.map((n) => n.position));
    expect(Math.min(...rows.map((n) => n.position))).toBeGreaterThan(last);
    // The workspace's own arrangement is not undone by the next update of the module.
    expect((await t.engine.modules.plan(t.owner, first)).changes.every((c) => c.action === 'noop')).toBe(true);
  });

  it('keeps a pinned nav item pinned, and follows the module when it stops pinning it', async () => {
    const make = (version: string, pinned: boolean) =>
      parseManifest({
        id: 'pinner',
        version,
        name: 'Pinner',
        description: 'Pins a row',
        icon: 'box',
        objects: [],
        navItems: [
          {
            id: 'pinner.start',
            label: 'Start',
            target: { kind: 'url' as const, url: '/start' },
            pinned,
          },
          { id: 'pinner.other', label: 'Other', target: { kind: 'url' as const, url: '/other' } },
        ],
      });
    await t.engine.modules.apply(t.owner, make('0.1.0', true));
    const pinnedOf = async (label: string) =>
      (await t.engine.metadata.getSchema(t.owner)).navItems.find((n) => n.label === label)?.pinned;
    expect(await pinnedOf('Start')).toBe(true);
    expect(await pinnedOf('Other')).toBe(false);
    // The workspace renaming a pinned row does not unpin it.
    const row = (await t.engine.metadata.getSchema(t.owner)).navItems.find((n) => n.label === 'Start');
    await t.engine.metadata.navItems.update(t.owner, row?.id as string, { label: 'Begin' });
    expect(await pinnedOf('Start')).toBe(true);
    await t.engine.modules.apply(t.owner, make('0.2.0', false));
    expect(await pinnedOf('Start')).toBe(false);
  });
});

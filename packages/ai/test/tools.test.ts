import { coreIds, imageFieldOf, type NavigateTarget } from '@devias/core';
import { type EngineContext, scopeEngine, silentLogger } from '@devias/data-engine';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ToolRunContext, WorkflowRunPort } from '../src/tools/types';
import { createHarness, enginePort, type Harness, platformTools } from './helpers';

let h: Harness;
const navigations: NavigateTarget[] = [];

beforeAll(async () => {
  h = await createHarness([]);
});
afterAll(() => h.close());

// biome-ignore lint/suspicious/noExplicitAny: a tool's result is untyped JSON that the tests read freely
const run = async (name: string, input: unknown, ctx = h.owner, workflows?: WorkflowRunPort): Promise<any> => {
  const tool = platformTools(h.engine).find((t) => t.name === name);

  if (!tool) {
    throw new Error(`no tool ${name}`);
  }

  const parsed = tool.input.parse(input);
  const context: ToolRunContext = {
    workspaceId: h.workspaceId,
    ctx,
    engine: h.engine,
    scoped: scopeEngine(h.engine, ctx),
    logger: silentLogger,
    navigate: (target) => navigations.push(target),
    actions: enginePort(h.engine, workflows),
    ...(workflows ? { workflows } : {}),
  };

  return tool.run(parsed, context);
};

describe('built-in tools', () => {
  it('lists the blocks a layout can place, from the studio and the installed modules', async () => {
    const record = await run('list_blocks', {});
    const ids = record.blocks.map((b: { id: string }) => b.id);
    expect(ids).toEqual(
      expect.arrayContaining([coreIds.blocks.fields, coreIds.blocks.activity, '01a17526-8e0c-7010-b63d-0d6dfe78eb9b']),
    );
    expect(ids).not.toContain('01a17522-1eb7-7744-b55d-a6cecb6732fe');
    const summary = record.blocks.find((b: { id: string }) => b.id === '01a17526-8e0c-7010-b63d-0d6dfe78eb9b');
    expect(summary).toMatchObject({ module: '01a1751f-5f09-7114-9d75-ce42abd8a6ef' });
    const home = await run('list_blocks', { surface: 'home' });
    expect(home.blocks.map((b: { id: string }) => b.id)).toContain('01a17522-1eb7-7744-b55d-a6cecb6732fe');
  });

  it('lists and describes objects with fields, options, relations and views', async () => {
    const list = await run('list_objects', {});
    expect(list.objects.map((o: { nameSingular: string }) => o.nameSingular)).toContain('opportunity');
    const described = await run('describe_object', { object: 'Opportunities' });
    expect(described.nameSingular).toBe('opportunity');
    const stage = described.fields.find((f: { name: string }) => f.name === 'stage');
    expect(stage.options).toEqual(['new', 'screening', 'meeting', 'proposal', 'customer', 'lost']);
    expect(described.fields.find((f: { name: string }) => f.name === 'company').relationTarget).toBe('company');
    expect(described.views.map((v: { label: string }) => v.label)).toEqual(['Pipeline', 'All opportunities']);
  });

  it('creates, reads, queries with filters and includes, searches, updates and deletes records', async () => {
    const company = await run('create_record', { object: 'company', data: { name: 'Globex', industry: 'software' } });
    expect(company).toMatchObject({
      created: true,
      object: 'company',
      label: 'Globex',
      link: `record:company/${company.id}`,
    });
    const person = await run('create_record', {
      object: 'person',
      data: { first_name: 'Hank', last_name: 'Scorpio', email: 'hank@globex.example', company: company.id },
    });
    const got = await run('get_record', { object: 'person', id: person.id });
    expect(got.record.labels).toEqual({ company: 'Globex' });

    const page = await run('list_records', {
      object: 'people',
      filter: { all: [{ field: 'company', op: 'eq', value: company.id }] },
      include: ['company'],
      fields: ['first_name', 'company'],
      limit: 5,
    });
    expect(page.totalCount).toBe(1);
    expect(page.items[0]).toMatchObject({
      id: person.id,
      label: 'Hank',
      first_name: 'Hank',
      labels: { company: 'Globex' },
    });
    expect(page.items[0].last_name).toBeUndefined();

    const any = await run('list_records', {
      object: 'person',
      filter: {
        any: [
          { field: 'first_name', op: 'eq', value: 'Hank' },
          { field: 'first_name', op: 'eq', value: 'Nobody' },
        ],
      },
    });
    expect(any.totalCount).toBe(1);

    // "Created or changed today": the system timestamps can be selected, sorted and filtered, and a plain date
    // (what people and models write) means the start of that day in UTC.
    const day = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const recent = await run('list_records', {
      object: 'person',
      fields: ['first_name', 'created_at', 'updated_at'],
      filter: { all: [{ field: 'updated_at', op: 'gte', value: day }] },
      sort: [{ field: 'updated_at', direction: 'desc' }],
    });
    expect(recent.totalCount).toBeGreaterThanOrEqual(1);
    expect(recent.items[0]).toMatchObject({ id: person.id });
    expect(typeof recent.items[0].created_at).toBe('string');
    const between = await run('list_records', {
      object: 'person',
      filter: { all: [{ field: 'created_at', op: 'between', value: [day, tomorrow] }] },
    });
    expect(between.items.map((item: { id: string }) => item.id)).toContain(person.id);
    const later = await run('list_records', {
      object: 'person',
      filter: { all: [{ field: 'created_at', op: 'gte', value: tomorrow }] },
    });
    expect(later.totalCount).toBe(0);

    const hits = await run('lookup_records', { text: 'scorp', objects: ['person'] });
    expect(hits.hits[0]).toMatchObject({ object: 'person', id: person.id, label: 'Hank' });

    const updated = await run('update_record', { object: 'person', id: person.id, patch: { city: 'Cypress Creek' } });
    expect(updated.record.city).toBe('Cypress Creek');

    const deleted = await run('delete_records', { object: 'person', ids: [person.id, person.id] });
    expect(deleted).toEqual({ deleted: 1, object: 'person', ids: [person.id] });
    // A record that is not there is an error, as it is for a person calling the same action.
    await expect(run('get_record', { object: 'person', id: person.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      run('get_record', { object: 'person', id: '00000000-0000-0000-0000-000000000009' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(run('list_records', { object: 'nope' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads an object and a field with the words that create_object and create_field write them with', async () => {
    const inputKeys = (name: string): string[] => {
      const tool = platformTools(h.engine).find((candidate) => candidate.name === name);
      const schema = z.toJSONSchema(tool?.input as z.ZodType, { unrepresentable: 'any', io: 'input' }) as {
        properties: Record<string, unknown>;
      };

      return Object.keys(schema.properties);
    };
    const described = await run('describe_object', { object: 'opportunity' });
    const words = (keys: string[]) => keys.filter((key) => /^(name|label|default)/.test(key)).sort();
    const written = words(inputKeys('create_object'));
    expect(words(Object.keys(described)).filter((key) => key !== 'name')).toEqual(written);
    expect(Object.keys(described)).not.toContain('plural');

    const withDefault = described.fields.find((field: Record<string, unknown>) => 'defaultValue' in field);
    expect(withDefault, 'a field with a default').toBeDefined();
    expect(inputKeys('create_field')).toContain('defaultValue');
    expect(Object.keys(withDefault)).not.toContain('default');
  });

  it('creates an object with fields, a default view and a sidebar entry', async () => {
    const result = await run('create_object', {
      nameSingular: 'project',
      namePlural: 'projects',
      labelSingular: 'Project',
      labelPlural: 'Projects',
      icon: 'folder',
      fields: [
        { name: 'title', type: 'text', label: 'Title', required: true },
        { name: 'status', type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }] },
        { name: 'owner', type: 'relation', label: 'Owner', relationTarget: 'person' },
      ],
    });
    expect(result.object).toMatchObject({ nameSingular: 'project', fieldCount: 3, viewCount: 1 });
    expect(result.fields.map((f: { name: string }) => f.name)).toEqual(['title', 'status', 'owner']);
    const { index } = await h.engine.metadata.getSnapshot(h.workspaceId);
    const object = index.objectsByName.get('project');
    const title = index.fieldsByObjectId.get(object?.id ?? '')?.find((f) => f.name === 'title');
    expect(object?.primaryFieldId).toBe(title?.id);
    expect(result.object.primaryFieldId).toBe(title?.id);
    const view = index.viewsByObjectId.get(object?.id ?? '')?.[0];
    expect(view).toMatchObject({ isDefault: true, type: 'table' });
    expect(view?.config.fields.map((f) => index.fieldsById.get(f.fieldId)?.name)).toEqual(['title', 'status', 'owner']);
    expect(index.schema.navItems.some((n) => n.label === 'Projects')).toBe(true);
    const created = await run('create_record', {
      object: 'project',
      data: { title: 'Website relaunch', status: 'open' },
    });
    expect(created.label).toBe('Website relaunch');
  });

  it('adds, changes and deletes fields, keeping the default view in sync and validating settings', async () => {
    await expect(
      run('create_field', { object: 'company', name: 'tier', type: 'select', label: 'Tier' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      run('create_field', { object: 'company', name: 'id', type: 'text', label: 'Id' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const created = await run('create_field', {
      object: 'company',
      name: 'tier',
      type: 'select',
      label: 'Tier',
      options: [{ value: 'gold', label: 'Gold' }],
    });
    expect(created.field).toMatchObject({ name: 'tier', type: 'select', options: ['gold'] });
    let { index } = await h.engine.metadata.getSnapshot(h.workspaceId);
    const company = index.objectsByName.get('company');
    // The company's table is the fixture module's: a field of the workspace's does not change it.
    let view = index.viewsByObjectId.get(company?.id ?? '')?.find((v) => v.isDefault);
    expect(view?.moduleId).toBe('01a1751f-5f09-7114-9d75-ce42abd8a6ef');
    expect(view?.config.fields.map((f) => index.fieldsById.get(f.fieldId)?.name)).not.toContain('tier');

    const updated = await run('update_field', {
      object: 'company',
      field: 'tier',
      label: 'Customer tier',
      addOptions: [{ value: 'silver', label: 'Silver' }],
      removeOptions: ['gold'],
    });
    expect(updated.field).toMatchObject({ label: 'Customer tier', options: ['silver'] });
    await expect(
      run('update_field', { object: 'company', field: 'name', addOptions: [{ value: 'x', label: 'x' }] }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    const relation = await run('create_field', {
      object: 'chore',
      name: 'account',
      type: 'relation',
      label: 'Account',
      relationTarget: 'companies',
    });
    expect(relation.field.relationTarget).toBe('company');

    expect(await run('delete_field', { object: 'company', field: 'tier' })).toEqual({
      deleted: true,
      object: 'company',
      field: 'tier',
    });
    ({ index } = await h.engine.metadata.getSnapshot(h.workspaceId));
    view = index.viewsByObjectId.get(company?.id ?? '')?.find((v) => v.isDefault);
    expect(index.fieldsByObjectId.get(company?.id ?? '')?.some((f) => f.name === 'tier')).toBe(false);
  });

  it('shows a new field in the default table of an object the workspace made', async () => {
    await run('create_object', {
      nameSingular: 'gizmo',
      namePlural: 'gizmos',
      labelSingular: 'Gizmo',
      labelPlural: 'Gizmos',
      fields: [{ name: 'name', type: 'text', label: 'Name' }],
    });
    await run('create_field', { object: 'gizmo', name: 'colour', type: 'text', label: 'Colour' });
    const { index } = await h.engine.metadata.getSnapshot(h.workspaceId);
    const gizmo = index.objectsByName.get('gizmo');
    const view = index.viewsByObjectId.get(gizmo?.id ?? '')?.find((v) => v.isDefault);
    expect(view?.config.fields.map((f) => index.fieldsById.get(f.fieldId)?.name)).toEqual(['name', 'colour']);
  });

  it('sets a link field as the picture of its records, and takes it back', async () => {
    const created = await run('create_field', {
      object: 'person',
      name: 'photo',
      type: 'url',
      label: 'Photo',
      image: true,
    });
    // The agent is told which link is the picture.
    expect(created.field).toMatchObject({ name: 'photo', type: 'url', image: true });
    const { index } = await h.engine.metadata.getSnapshot(h.workspaceId);
    const person = index.objectsByName.get('person');
    expect((person && imageFieldOf(index, person))?.name).toBe('photo');

    const off = await run('update_field', { object: 'person', field: 'photo', image: false });
    expect(off.field).not.toHaveProperty('image');
    const on = await run('update_field', { object: 'person', field: 'photo', image: true });
    expect(on.field).toMatchObject({ image: true });
    await expect(run('update_field', { object: 'person', field: 'first_name', image: true })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await run('delete_field', { object: 'person', field: 'photo' });
  });

  it('creates and updates views, requiring a select groupBy for kanban', async () => {
    await expect(run('create_view', { object: 'chore', label: 'Board', type: 'kanban' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(
      run('create_view', { object: 'chore', label: 'Board', type: 'kanban', groupBy: 'title' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const created = await run('create_view', {
      object: 'chore',
      label: 'Board',
      type: 'kanban',
      groupBy: 'done',
      fields: ['title', 'due_date'],
      filter: { all: [{ field: 'done', op: 'eq', value: false }] },
      sorts: [{ field: 'due_date', direction: 'asc' }],
    });
    expect(created.view).toMatchObject({
      label: 'Board',
      type: 'kanban',
      fields: ['title', 'due_date'],
      groupBy: 'done',
      filter: { field: 'done', op: 'eq', value: false },
    });
    const updated = await run('update_view', {
      object: 'chore',
      view: 'Board',
      label: 'Task board',
      filter: null,
      fields: ['title'],
      isDefault: true,
    });
    expect(updated.view).toMatchObject({ id: created.view.id, label: 'Task board', fields: ['title'], default: true });
    expect(updated.view.filter).toBeUndefined();
  });

  it('validates navigation targets and queues them for the studio', async () => {
    navigations.length = 0;
    const company = await run('create_record', { object: 'company', data: { name: 'Navico' } });
    expect(await run('navigate', { target: { kind: 'record', object: 'company', id: company.id } })).toMatchObject({
      ok: true,
    });
    await expect(
      run('navigate', { target: { kind: 'record', object: 'company', id: '00000000-0000-0000-0000-000000000009' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await run('navigate', { target: { kind: 'object', object: 'opportunity', viewId: 'Pipeline' } }),
    ).toMatchObject({
      opened: 'opportunities (Pipeline)',
    });
    expect(await run('navigate', { target: { kind: 'settings', section: 'data-model' } })).toMatchObject({ ok: true });
    expect(navigations).toHaveLength(3);
    expect(navigations[1]).toMatchObject({ kind: 'object', object: 'opportunity' });
    expect((navigations[1] as { viewId?: string }).viewId).toBe('01a17522-9493-74bb-9f20-b69ed17e9143');
  });
});

describe('workflow tools', () => {
  const UUID = /^[0-9a-f-]{36}$/;
  const kickoff = {
    title: 'Kickoff',
    description: 'Close won deals and open a kickoff task',
    trigger: {
      kind: 'record_event',
      objectId: 'Opportunities',
      types: ['record.updated'],
      fieldIds: ['Stage'],
      condition: { field: 'stage', op: 'eq', value: 'customer' },
    },
    steps: [
      {
        id: 'close',
        kind: 'action',
        actionId: coreIds.actions.update_record,
        input: { object: 'Opportunities', id: '{{record.id}}', values: { Probability: 100 } },
      },
      {
        id: 'size',
        kind: 'branch',
        condition: { field: 'amount', op: 'gte', value: 1000 },
        yes: [
          {
            kind: 'action',
            actionId: coreIds.actions.create_record,
            input: {
              object: 'Chores',
              values: { title: 'Kick off {{record.name}}', 'Due date': '{{today}}', opportunity: '{{record.id}}' },
            },
          },
        ],
        no: [],
      },
    ],
  };

  it('creates a workflow from labels and reads it back in the shape update_workflow takes', async () => {
    const created = await run('create_workflow', kickoff);
    expect(created).toMatchObject({
      created: true,
      title: 'Kickoff',
      enabled: true,
      stepCount: 3,
      link: `workflow:${created.id}`,
      trigger: {
        kind: 'record_event',
        objectId: '01a17522-1eb7-7744-b55d-ab0f8f95f17d',
        fieldIds: ['01a17522-9493-74bb-9f20-bb523e19b8fb'],
      },
    });
    expect(created.steps[0]).toEqual({
      id: 'close',
      kind: 'action',
      actionId: coreIds.actions.update_record,
      input: { object: 'opportunity', id: '{{record.id}}', values: { probability: 100 } },
    });
    const lane = created.steps[1].yes[0];
    expect(lane).toMatchObject({
      kind: 'action',
      actionId: coreIds.actions.create_record,
      input: { object: 'chore', values: { due_date: '{{today}}' } },
    });
    expect(lane.id).toMatch(UUID);

    const got = await run('get_workflow', { workflow: 'kickoff' });
    expect(got).toMatchObject({ id: created.id, steps: created.steps, recentRuns: [] });

    // What get_workflow returns goes back into update_workflow unchanged, step ids included.
    const renamed = await run('update_workflow', {
      workflow: created.id,
      title: 'Customer kickoff',
      description: null,
      steps: got.steps,
    });
    expect(renamed).toMatchObject({ updated: true, title: 'Customer kickoff', steps: created.steps });
    expect(renamed.description).toBeUndefined();
    const off = await run('update_workflow', { workflow: 'Customer kickoff', enabled: false });
    expect(off).toMatchObject({ updated: true, enabled: false });
    expect(await run('update_workflow', { workflow: created.id })).toEqual({
      updated: false,
      message: 'Nothing to change',
    });
  });

  it('lists workflows, filtered by object and trigger', async () => {
    await run('create_workflow', {
      title: 'Check company',
      trigger: { kind: 'manual', objectId: 'company' },
      steps: [
        {
          id: 'fn',
          kind: 'action',
          actionId: coreIds.actions.create_record,
          input: { object: 'note', values: { title: 'Checked {{record.name}}' } },
        },
      ],
    });
    const all = await run('list_workflows', {});
    expect(all.workflows.map((w: { title: string }) => w.title)).toEqual(
      expect.arrayContaining(['Customer kickoff', 'Check company']),
    );
    const manual = await run('list_workflows', { object: 'Companies', trigger: 'manual' });
    expect(manual.workflows).toEqual([expect.objectContaining({ title: 'Check company', stepCount: 1 })]);
  });

  it('rejects references the workspace does not have, naming the ones it does', async () => {
    await expect(
      run('create_workflow', {
        ...kickoff,
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'opportunity', id: '{{record.id}}', values: { nope: 1 } },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('probability') });
    await expect(
      run('create_workflow', {
        title: 'Bad',
        trigger: { kind: 'manual', objectId: 'company' },
        steps: [{ kind: 'action', actionId: '01a17522-1ec0-7239-918f-3767379d8492', input: {} }],
      }),
    ).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('no installed module declares it'),
    });
    await expect(
      run('create_workflow', {
        title: 'Bad',
        trigger: { kind: 'schedule', cron: '0 * * * *' },
        steps: [
          {
            kind: 'action',
            actionId: coreIds.actions.update_record,
            input: { object: 'company', id: '{{record.id}}', values: { name: 'x' } },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(run('get_workflow', { workflow: 'Nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('Customer kickoff'),
    });
  });

  it("runs a workflow through the host's runner as the caller and previews step outputs", async () => {
    const workflow = await run('get_workflow', { workflow: 'Check company' });
    const company = await run('create_record', { object: 'company', data: { name: 'Runco' } });
    await expect(run('run_workflow', { workflow: 'Check company', recordId: company.id })).rejects.toMatchObject({
      code: 'MISSING_DEPENDENCY',
    });
    const calls: { actor: EngineContext['actor']; workflowId: string; input: unknown }[] = [];
    const port: WorkflowRunPort = {
      runManual: async (ctx, workflowId, input) => {
        calls.push({ actor: ctx.actor, workflowId, input });

        return {
          id: '0192f000-0000-7000-8000-000000000001',
          workflowId,
          status: 'succeeded',
          trigger: {
            kind: 'manual',
            objectId: '01a1751f-5f09-7114-9d75-c6298b7cb4b3',
            ...(input.recordId ? { recordId: input.recordId } : {}),
          },
          steps: [
            {
              id: 'fn',
              kind: 'action',
              actionId: coreIds.actions.create_record,
              status: 'succeeded',
              output: { text: 'x'.repeat(2000) },
            },
          ],
          createdAt: '2026-09-29T10:00:00.000Z',
          startedAt: '2026-09-29T10:00:00.000Z',
          finishedAt: '2026-09-29T10:00:01.000Z',
        };
      },
    };
    const result = await run('run_workflow', { workflow: 'Check company', recordId: company.id }, h.member, port);
    expect(calls).toEqual([{ actor: h.member.actor, workflowId: workflow.id, input: { recordId: company.id } }]);
    expect(result).toMatchObject({
      workflow: { id: workflow.id, title: 'Check company' },
      status: 'succeeded',
      record: `record:company/${company.id}`,
    });
    expect(result.steps[0].output).toMatch(/…$/);
    expect(result.steps[0].output.length).toBeLessThan(600);
  });

  it('pages through the runs of a workflow, newest first', async () => {
    const workflow = await run('get_workflow', { workflow: 'Customer kickoff' });

    for (const status of ['succeeded', 'failed'] as const) {
      const at = new Date().toISOString();
      await h.engine.workflows.recordRun(h.workspaceId, {
        workflowId: workflow.id,
        status,
        trigger: {
          kind: 'record_event',
          objectId: '01a17522-1eb7-7744-b55d-ab0f8f95f17d',
          eventType: 'record.updated',
          sequence: 1,
        },
        steps: [
          {
            id: 'close',
            kind: 'action',
            actionId: coreIds.actions.update_record,
            status: status,
            ...(status === 'failed' ? { error: 'boom' } : {}),
          },
        ],
        ...(status === 'failed' ? { error: 'Step 1 (updateRecord) failed: boom' } : {}),
        startedAt: at,
        finishedAt: at,
      });
    }

    const page = await run('list_workflow_runs', { workflow: workflow.id, limit: 1 });
    expect(page.runs).toEqual([expect.objectContaining({ status: 'failed', error: expect.stringContaining('boom') })]);
    expect(page.runs[0].steps).toEqual([
      { id: 'close', kind: 'action', actionId: coreIds.actions.update_record, status: 'failed', error: 'boom' },
    ]);
    const next = await run('list_workflow_runs', { workflow: workflow.id, cursor: page.nextCursor });
    expect(next.runs.map((r: { status: string }) => r.status)).toEqual(['succeeded']);
    expect(next.nextCursor).toBeUndefined();
    const recent = (await run('get_workflow', { workflow: workflow.id })).recentRuns;
    expect(recent.map((r: { status: string }) => r.status)).toEqual(['failed', 'succeeded']);
  });

  it('offers members the reading and running tools only, and opens the editor for admins', async () => {
    const names = [
      'list_workflows',
      'get_workflow',
      'list_workflow_runs',
      'create_workflow',
      'update_workflow',
      'delete_workflow',
      'run_workflow',
    ];
    const visible = (ctx: EngineContext) =>
      names.filter(
        (name) =>
          platformTools(h.engine)
            .find((t) => t.name === name)
            ?.available?.(ctx, h.engine) !== false,
      );
    expect(visible(h.owner)).toEqual(names);
    expect(visible(h.member)).toEqual(['list_workflows', 'get_workflow', 'list_workflow_runs', 'run_workflow']);

    navigations.length = 0;
    const workflow = await run('get_workflow', { workflow: 'Customer kickoff' });
    expect(await run('navigate', { target: { kind: 'workflow', id: 'customer kickoff' } })).toEqual({
      ok: true,
      opened: 'workflow "Customer kickoff"',
    });
    expect(navigations).toEqual([{ kind: 'workflow', id: workflow.id }]);
    await expect(run('navigate', { target: { kind: 'workflow', id: workflow.id } }, h.member)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('deletes a workflow with its runs', async () => {
    const removed = await run('delete_workflow', { workflow: 'Customer kickoff' });
    expect(removed).toMatchObject({ deleted: true, title: 'Customer kickoff' });
    await expect(run('get_workflow', { workflow: removed.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
